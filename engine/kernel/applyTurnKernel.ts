/* engine/kernel/applyTurnKernel.ts */
import { deepMerge } from "@/engine/utils/deepMerge";
import { ensureAJPrimed } from "./priming";
import { resolveDriver } from "@/engine/registry";
import { validateAjOutputOrThrow } from "./validation";
import { enforceProbePolicy } from "./probe_policy";
import { thetaService } from "@/engine/services/theta";
import type {
  ItemEnvelope, SchemaEnvelope, SessionSnapshot, Json,
  UnitStateEnvelope, ThetaState, DriverDecision, ScorePayload, KernelPolicy, ScoringSpecification, TranscriptEntry
} from "@/types/kernel";
import { loadBank, getSchemaById, getItemById } from "@/lib/bank";

/* Deterministic RNG (xorshift32) seeded by string */
function seededRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let x = h || 0x9e3779b9;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x >>>= 0; x ^= x << 5; x >>>= 0; return (x >>> 0) / 0xffffffff; };
}

/* Resolve primary ability key */
function abilityKeyOf(schema: SchemaEnvelope): string {
  const a = schema.Ability ?? {};
  if (a.key) return a.key;
  if (Array.isArray(a.keys) && a.keys.length > 0) return a.keys[0]!;
  return "global";
}

/* Wrap legacy/new driver payload into a UnitStateEnvelope (kernel owns meta) */
function toEnvelope(
  rawState: any,
  schema: SchemaEnvelope,
  item: ItemEnvelope,
  driverId: string,
  driverVersion: string
): UnitStateEnvelope {
  if (rawState && typeof rawState === "object" && "meta" in rawState && "payload" in rawState) {
    // It's already an envelope. Return it as-is.
    return rawState as UnitStateEnvelope;
  }
  return {
    meta: {
      driverId,
      driverVersion,
      contractVersion: schema.GuidanceVersion,
      schemaId: schema.SchemaID,
      itemId: item.ItemID,
      abilityKey: abilityKeyOf(schema),
      startedAtMs: Date.now(),
      turnCount: 0,
      attempts: 0,
      consecutiveUnproductive: 0,
      totalUnproductive: 0,
    },
    payload: rawState ?? {},
  };
}

// Narrow AEG-like driver state without coupling to a specific driver type
function isAEGLikeState(x: unknown): x is { distinctCount?: number; acceptedThemeTags?: string[]; targetDistinct?: number } {
  if (!x || typeof x !== 'object') return false;
  const anyx: any = x;
  return typeof anyx.distinctCount === 'number' || Array.isArray(anyx.acceptedThemeTags);
}

/* ---- Kernel turn entry point ------------------------------------------- */
export async function applyTurnKernel(params: {
  session: SessionSnapshot;
  sessionPersist?: (s: SessionSnapshot) => Promise<void>;
  schemaId: string;
  itemId: string;
  userText: string;
  ajRaw: unknown;
}) {
  const { session } = params;

  // 1) Load schema & item
  const bank = await loadBank();
  const schema = getSchemaById(bank, params.schemaId);
  const item = getItemById(bank, params.itemId);

  // 2) Prime AJ once per (driver, GuidanceVersion)
  await ensureAJPrimed(session, schema, item);

  // 3) Resolve driver & thin merges
  const driver = resolveDriver(schema.Engine ?? {});
  const policy: KernelPolicy = deepMerge(schema.PolicyDefaults ?? {}, item.DriverOverrides?.Policy ?? {}, { arrayStrategy: "replace" });
  const scoring: ScoringSpecification = deepMerge(schema.ScoringSpec ?? {}, item.DriverOverrides?.Scoring ?? {}, { arrayStrategy: "replace" });

  // 4) Kernel budgets
  // Only enforce time budget if explicitly provided at schema/item level
  const timeBudgetSec = (policy.TimeBudgetSec == null || Number.isNaN(Number(policy.TimeBudgetSec))) ? null : Number(policy.TimeBudgetSec);
  const maxConsecFail = policy.MaxConsecutiveFailedAttempts ?? 2;
  const maxTotalFail = policy.MaxTotalFailedAttempts ?? 3;

  // 5) Ensure envelope state for this unit
  const abilityKey = abilityKeyOf(schema);
  if (!session.unit || session.unit.completed || session.unit.driverId !== driver.id || session.unit.state.meta.itemId !== item.ItemID) {
    const initPayload = driver.initUnitState(schema, item);
    session.unit = { driverId: driver.id, state: toEnvelope(initPayload, schema, item, driver.id, driver.version), completed: false };
  }
  const env = session.unit.state; // Work directly with the session's state object

  // Kernel-owned meta counters
  env.meta.turnCount = (env.meta.turnCount ?? 0) + 1;
  if (env.meta.attempts == null) env.meta.attempts = 0;
  // DO NOT reset counters here. They are persisted in the envelope.

  // 6) Time bookkeeping
  const startedAt = env.meta.startedAtMs ?? Date.now();
  const elapsedMs = Date.now() - startedAt;

  // 7) Validate AJ contract (Safety Catch)
  let ajValidated: Json | null = null;
  let ajValidationError: Error | null = null;
  try { validateAjOutputOrThrow(schema, params.ajRaw); ajValidated = params.ajRaw as Json; } catch (err: any) { ajValidationError = err; }

  // 8) Deterministic RNG
  const rng = seededRng(`${session.id}:${driver.id}:${item.ItemID}:${env.meta.turnCount}`);

  // 9) Driver decision
  let decision: DriverDecision<Json>;
  if (ajValidationError) {
    decision = {
      credited: 0,
      score: { value: 0, label: "aj_contract_invalid" },
      budgetSignal: "unproductive",
      probe: { id: null, text: "I couldn’t parse that—please answer in the expected format.", category: "format" },
      uiBadges: ["AJ Contract: Invalid"],
      completed: false,
      telemetry: { error: String(ajValidationError.message) },
      newState: env.payload,
      error_code: "AJ_SCHEMA_INVALID",
    };
  } else {
    const ajParsed = driver.parseAJOutput(ajValidated, schema, item);
    decision = driver.applyTurn({
      schema, item,
      unitState: env.payload,
      aj: ajParsed,
      userText: params.userText,
      policy,
      scoring,
      rng,
    });
  }

  // 10) Kernel budget counters (persisted in envelope meta)
  env.meta.attempts! += 1;
  if (decision.budgetSignal === "unproductive") {
    env.meta.consecutiveUnproductive = (env.meta.consecutiveUnproductive ?? 0) + 1;
    env.meta.totalUnproductive = (env.meta.totalUnproductive ?? 0) + 1;
  } else if (decision.budgetSignal === "productive") {
    env.meta.consecutiveUnproductive = 0;
  }
  // 'neutral' leaves streak as-is

  const timeExpired = timeBudgetSec != null && elapsedMs > timeBudgetSec * 1000;
  const consecFailExceeded = (env.meta.consecutiveUnproductive ?? 0) >= maxConsecFail;
  const totalFailExceeded = (env.meta.totalUnproductive ?? 0) >= maxTotalFail;
  const domainDone = !!decision.completed;
  const completed = domainDone || timeExpired || consecFailExceeded || totalFailExceeded;

  // 11) Θ update (central): defer updates until completion
  let score: ScorePayload = { value: 0, label: "intra_turn_no_change" };
  if (completed) {
    // Preferred: compute from driver state if AEG-like structure is present
    const stUnknown = decision.newState as unknown;
    if (isAEGLikeState(stUnknown)) {
      const dc = typeof stUnknown.distinctCount === 'number'
        ? stUnknown.distinctCount
        : (Array.isArray(stUnknown.acceptedThemeTags) ? stUnknown.acceptedThemeTags.length : 0);
      const target = Math.max(1, typeof stUnknown.targetDistinct === 'number' ? stUnknown.targetDistinct : 2);
      // Optional override: per-distinct mapping from scoring spec (item or schema)
      const perDistinct = scoring?.final?.perDistinct;
      if (perDistinct && typeof perDistinct === 'object') {
        const key = String(dc);
        const mapped = perDistinct[key];
        if (typeof mapped === 'number' && Number.isFinite(mapped)) {
          score = { value: mapped, label: 'final_per_distinct' };
        } else {
          // Fallback to general formula when unmapped
          const value = dc >= target ? 1 : - (target - dc) / target;
          score = { value, label: 'final_general_formula' };
        }
      } else {
        // General formula supports arbitrary target sizes:
        // value = 1 if D >= T, else value = - (T - D) / T
        const value = dc >= target ? 1 : - (target - dc) / target;
        score = { value, label: 'final_general_formula' };
      }
    } else if (decision.score && typeof decision.score.value === 'number') {
      // Fallback to driver's provided score if not AEG
      score = decision.score;
    } else if (Number.isFinite(Number(decision.credited))) {
      score = { value: Number(decision.credited), label: 'final_credited' };
    } else {
      score = { value: 0, label: 'final_default_zero' };
    }
  }
  const theta: ThetaState = thetaService.update(session.theta, abilityKey, score, scoring);

  // 12) Sanitize AJ-generated probe per schema policy
  const policyCheck = enforceProbePolicy(schema, decision.probe ?? null);

  // 13) Persist session snapshot (envelope carries budgets)
  session.unit.state.payload = decision.newState; // Update the payload in place
  session.theta = theta;
  session.unit.completed = completed;

  // --- Transcript update ---
  const lastEntry = session.transcript ? session.transcript[session.transcript.length - 1] : null;
  if (!lastEntry || lastEntry.item_id !== item.ItemID) {
    // New item, create new entry
    const newEntry: TranscriptEntry = {
      item_id: item.ItemID,
      text: item.Stem,
      answer: params.userText,
      label: "kernel",
      theta_state_before: session.theta,
      exchanges: policyCheck.probe ? [{ probe_text: policyCheck.probe.text, probe_answer: "", label: "None" }] : [],
    };
    session.transcript = [...(session.transcript || []), newEntry];
  } else {
    // Update existing entry for this item
    const lastExchange = lastEntry.exchanges[lastEntry.exchanges.length - 1];
    if (lastExchange && !lastExchange.probe_answer) {
      lastExchange.probe_answer = params.userText;
    }
    if (policyCheck.probe) {
      lastEntry.exchanges.push({ probe_text: policyCheck.probe.text, probe_answer: "", label: "None" });
    }
  }

  if (params.sessionPersist) await params.sessionPersist(session);

  // 14) Response
  return {
    credited: decision.credited,
    score,
    uiBadges: decision.uiBadges ?? [],
    probe: policyCheck.probe,
    theta,
    completed,
    telemetry: Object.assign({}, decision.telemetry, {
      error_code: decision.error_code ?? null,
      ability_key: abilityKey,
      attempts: env.meta.attempts ?? 0,
      consecutive_unproductive: env.meta.consecutiveUnproductive ?? 0,
      total_unproductive: env.meta.totalUnproductive ?? 0,
      time_elapsed_ms: elapsedMs,
      time_expired: timeExpired,
      consecutive_fail_exceeded: consecFailExceeded,
      total_fail_exceeded: totalFailExceeded,
      domain_done: domainDone,
      aj_probe_blocked: policyCheck.blocked,
      aj_probe_truncated: policyCheck.truncated,
      aj_probe_reason: policyCheck.reason ?? null,
    }),
    unitState: session.unit.state,
    transcript: session.transcript,
  };
}
