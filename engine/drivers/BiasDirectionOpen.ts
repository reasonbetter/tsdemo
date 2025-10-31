/* eslint-disable @typescript-eslint/no-explicit-any */ // moved from CategoricalPath.ts
import type {
  AJInitPayload,
  DriverDecision,
  DriverProbe,
  ItemEnvelope,
  SchemaEnvelope,
  ScorePayload,
  Json,
  ScoringSpecification,
  SkillDriver,
} from "@/types/kernel";

type AnswerType =
  | "Both_Explained"
  | "MaskedBenefit_Only_Explained"
  | "MaskedHarm_Only_Explained"
  | "NotSpecific"
  | "NotDistinct"
  | "NotPlausible"
  | "NotClear"
  | "NotRelevant";

type ProbeDef = { id: string; text: string };

type Policy = {
  ConfidencePolicy?: { MinConfidence?: number };
  ClarificationPolicy?: { MaxTotal?: number; MaxConsecutiveNotClear?: number; MaxConsecutiveNotSpecific?: number };
  MaxTotalTurns?: number;
};

type TurnRecord = { t: AnswerType; at: number };

type State = {
  // Sequence of non-clarity AnswerTypes (order matters)
  seq: TurnRecord[];
  // Clarity tracking
  clarificationsUsed: number;
  // Track streak by type to mirror AEG semantics
  clarStreakType: "NotClear" | "NotSpecific" | null;
  clarStreak: number;
  // Probe usage tracking
  usedProbeIDs: string[];
  // Completion
  completed: boolean;
  pathId: string | null;
};

const asNum = (v: any, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) || d : d);

function extractConfig(schema: SchemaEnvelope) {
  const dc: any = (schema as any).DriverConfig ?? {};
  const AJ_System_Guidance = dc.AJ_System_Guidance ?? (schema as any).AJ_System_Guidance ?? {};
  const ConfidencePolicy = { MinConfidence: asNum(dc?.ConfidencePolicy?.MinConfidence, 0.6) };
  const ClarificationPolicy = {
    MaxTotal: asNum(dc?.ClarificationPolicy?.MaxTotal, 2),
    MaxConsecutiveNotClear: asNum(dc?.ClarificationPolicy?.MaxConsecutiveNotClear, 1),
    MaxConsecutiveNotSpecific: asNum(dc?.ClarificationPolicy?.MaxConsecutiveNotSpecific, 1),
  };
  const MaxTotalTurns = asNum((schema as any)?.PolicyDefaults?.MaxTotalTurns ?? dc?.MaxTotalTurns, 3);
  const pathMap: Array<{ PathID: string; Score: number }> = ((schema as any)?.ScoringSpec?.PathMap ?? []) as any;
  // Optional mapping support (and default compatibility mapping)
  const AnswerTypeMap: Record<string, string> = { ...(dc?.AnswerTypeMap ?? {}) };
  if (!AnswerTypeMap["Neither_Explained_Sufficiently"]) AnswerTypeMap["Neither_Explained_Sufficiently"] = "NotSpecific";
  return { AJ_System_Guidance, ConfidencePolicy, ClarificationPolicy, MaxTotalTurns, pathMap, AnswerTypeMap };
}

function pickProbe(lib: Record<string, ProbeDef[]>, cat: string, used: string[], rec?: string): { probe: DriverProbe | null; usedOut: string[] } {
  let group = lib[cat] ?? [];
  // Back-compat: allow legacy category name for NotSpecific
  if ((!group || group.length === 0) && cat === "NotSpecific") {
    group = (lib as any)["Neither_Explained_Sufficiently"] ?? [];
  }
  if (rec) {
    const c = group.find(p => p.id === rec);
    if (c && !used.includes(c.id)) return { probe: { id: c.id, text: c.text, category: cat }, usedOut: used.concat(c.id) };
  }
  const u = group.find(p => !used.includes(p.id)) ?? group[0];
  if (u) return { probe: { id: u.id, text: u.text, category: cat }, usedOut: used.concat(u.id) };
  return { probe: null, usedOut: used.slice() };
}

export const BiasDirectionOpenDriver: SkillDriver<State, Policy, ScoringSpecification, { AnswerType: AnswerType; Confidence: number; RecommendedProbeID?: string }> = {
  id: "bias.direction.open.v1",
  kind: "bias.direction.open",
  version: "1.0.0",
  capabilities: { usesProbes: true, continuousScore: false, needsScenarioInTurn: false },

  buildAJInit(schema: SchemaEnvelope): AJInitPayload {
    const cfg = extractConfig(schema);
    return { system: cfg.AJ_System_Guidance, context: null };
  },

  initUnitState(): State {
    return { seq: [], clarificationsUsed: 0, clarStreakType: null, clarStreak: 0, usedProbeIDs: [], completed: false, pathId: null };
  },

  migrateState(stored: Json): State {
    const s: any = stored ?? {};
    return {
      seq: Array.isArray(s.seq) ? s.seq : [],
      clarificationsUsed: asNum(s.clarificationsUsed, 0),
      clarStreakType: (s.clarStreakType ?? null) as any,
      clarStreak: asNum(s.clarStreak, 0),
      usedProbeIDs: Array.isArray(s.usedProbeIDs) ? s.usedProbeIDs : [],
      completed: !!s.completed,
      pathId: s.pathId ?? null,
    };
  },

  parseAJOutput(raw: unknown, schema?: SchemaEnvelope): { AnswerType: AnswerType; Confidence: number; RecommendedProbeID?: string } {
    const o: any = raw ?? {};
    const rawAt = String(o?.AnswerType ?? "");
    const cfg = schema ? extractConfig(schema) : { AnswerTypeMap: {} } as any;
    const mapped = (cfg.AnswerTypeMap?.[rawAt] ?? rawAt) as string;
    const allowed: AnswerType[] = [
      "Both_Explained",
      "MaskedBenefit_Only_Explained",
      "MaskedHarm_Only_Explained",
      "NotSpecific",
      "NotDistinct",
      "NotPlausible",
      "NotClear",
      "NotRelevant",
    ];
    if (!(allowed as readonly string[]).includes(mapped as any)) throw new Error(`CategoricalPath.parse: invalid AnswerType '${rawAt}' (mapped to '${mapped}')`);
    return { AnswerType: mapped as AnswerType, Confidence: asNum(o?.Confidence, 0), RecommendedProbeID: o?.RecommendedProbeID == null ? undefined : String(o.RecommendedProbeID) };
  },

  applyTurn({ schema, item, unitState, aj, policy }): DriverDecision<State> {
    const cfg = extractConfig(schema);
    const st: State = { ...(unitState as State) };
    const lib: Record<string, ProbeDef[]> = ((item as any)?.Content?.ProbeLibrary) ?? {};

    // Handle NotRelevant quickly
    if (aj.AnswerType === "NotRelevant") {
      const pick = pickProbe(lib, "NotRelevant", st.usedProbeIDs, aj.RecommendedProbeID);
      st.usedProbeIDs = pick.usedOut;
      return { credited: 0, score: { value: 0, label: "not_relevant" }, budgetSignal: "unproductive", probe: pick.probe, uiBadges: ["NotRelevant"], completed: false, telemetry: { seq: st.seq }, newState: st };
    }

    // NotClear with elucidation caps
    if (aj.AnswerType === "NotClear") {
      const canTotal = st.clarificationsUsed < (cfg.ClarificationPolicy.MaxTotal ?? 2);
      const streak = st.clarStreakType === "NotClear" ? (st.clarStreak ?? 0) : 0;
      const canStreak = streak < (cfg.ClarificationPolicy.MaxConsecutiveNotClear ?? 1);
      if (canTotal && canStreak) {
        const pick = pickProbe(lib, "NotClear", st.usedProbeIDs, aj.RecommendedProbeID);
        st.usedProbeIDs = pick.usedOut;
        st.clarificationsUsed += 1;
        st.clarStreakType = "NotClear";
        st.clarStreak = streak + 1;
        return { credited: 0, score: { value: 0, label: "not_clear" }, budgetSignal: "neutral", probe: pick.probe, uiBadges: ["NotClear"], completed: false, telemetry: { seq: st.seq }, newState: st };
      }
      // Exceeded: fall-through to continue flow without additional clarification
    } else {
      // Reset streak when switching away from NotClear
      if (st.clarStreakType === "NotClear") { st.clarStreakType = null; st.clarStreak = 0; }
    }

    // NotSpecific clarification handling (modeled after AEG)
    if (aj.AnswerType === "NotSpecific") {
      const canTotal = st.clarificationsUsed < (cfg.ClarificationPolicy.MaxTotal ?? 2);
      const streak = st.clarStreakType === "NotSpecific" ? (st.clarStreak ?? 0) : 0;
      const canStreak = streak < (cfg.ClarificationPolicy.MaxConsecutiveNotSpecific ?? 1);
      const pick = pickProbe(lib, "NotSpecific", st.usedProbeIDs, aj.RecommendedProbeID);
      st.usedProbeIDs = pick.usedOut;
      if (canTotal && canStreak) {
        st.clarificationsUsed += 1;
        st.clarStreakType = "NotSpecific";
        st.clarStreak = streak + 1;
        // Record NotSpecific in seq to preserve GP-dependent paths
        st.seq = [...st.seq, { t: "NotSpecific", at: Date.now() }];
        return { credited: 0, score: { value: 0, label: "not_specific" }, budgetSignal: "neutral", probe: pick.probe, uiBadges: ["NotSpecific"], completed: false, telemetry: { seq: st.seq }, newState: st };
      }
      // If exceeded, nudge with NotPlausible category as a terminal-style hint
      const np = pickProbe(lib, "NotPlausible", st.usedProbeIDs, aj.RecommendedProbeID);
      st.usedProbeIDs = np.usedOut;
      st.seq = [...st.seq, { t: "NotSpecific", at: Date.now() }];
      return { credited: 0, score: { value: 0, label: "not_specific_cap_exceeded" }, budgetSignal: "unproductive", probe: np.probe, uiBadges: ["NotSpecific"], completed: false, telemetry: { seq: st.seq }, newState: st };
    }

    // Record only core AnswerTypes and NotSpecific for path logic
    {
      const core: AnswerType[] = ["Both_Explained","MaskedBenefit_Only_Explained","MaskedHarm_Only_Explained","NotSpecific"];
      if (core.includes(aj.AnswerType)) {
        st.seq = [...st.seq, { t: aj.AnswerType, at: Date.now() }];
      }
    }

    // Determine completion and scoring
    const seq = st.seq.map(s => s.t);
    const next = decideCompletionAndPath(seq, cfg.pathMap, cfg.MaxTotalTurns);
    if (next.complete) {
      st.completed = true; st.pathId = next.pathId ?? null;
      return { credited: 0, score: { value: next.score, label: "path_dependent" }, budgetSignal: next.score > 0 ? "productive" : "unproductive", probe: null, uiBadges: [next.pathId!], completed: true, telemetry: { seq }, newState: st };
    }

    // Choose next probe CATEGORY = current AnswerType
    const category = aj.AnswerType;
    // Handle meta categories that don't affect path directly
    if (category === "NotDistinct" || category === "NotPlausible") {
      const pick = pickProbe(lib, category, st.usedProbeIDs, aj.RecommendedProbeID);
      st.usedProbeIDs = pick.usedOut;
      return { credited: 0, score: { value: 0, label: category === "NotDistinct" ? "not_distinct" : "not_plausible" }, budgetSignal: "unproductive", probe: pick.probe, uiBadges: [category], completed: false, telemetry: { seq }, newState: st };
    }
    const pick = pickProbe(lib, category, st.usedProbeIDs, aj.RecommendedProbeID);
    st.usedProbeIDs = pick.usedOut;
    return { credited: 0, score: { value: 0, label: "in_progress" }, budgetSignal: "neutral", probe: pick.probe, uiBadges: [category], completed: false, telemetry: { seq }, newState: st };
  },
};

function decideCompletionAndPath(seq: AnswerType[], pathMap: Array<{ PathID: string; Score: number }>, maxTurns: number): { complete: boolean; pathId?: string; score: number } {
  const scoreOf = (id: string, fallback: number) => (pathMap.find(p => p.PathID === id)?.Score ?? fallback);
  const oneOnly = (t?: AnswerType) => t === "MaskedBenefit_Only_Explained" || t === "MaskedHarm_Only_Explained";
  // Limits: complete when Both occurs, or when reached maxTurns, or when path is determinable
  if (seq[0] === "Both_Explained") return { complete: true, pathId: "P1_Spontaneous_Both", score: scoreOf("P1_Spontaneous_Both", 2.0) };
  if (seq.length >= 2 && seq[0] === "NotSpecific" && seq[1] === "Both_Explained") return { complete: true, pathId: "P2_GP_Both", score: scoreOf("P2_GP_Both", 1.0) };
  if (seq.length >= 2 && oneOnly(seq[0]) && (oneOnly(seq[1]) || seq[1] === "Both_Explained")) return { complete: true, pathId: "P3_Spontaneous_One_FP_Success", score: scoreOf("P3_Spontaneous_One_FP_Success", 0.8) };
  if (seq.length >= 3 && seq[0] === "NotSpecific" && oneOnly(seq[1]) && (oneOnly(seq[2]) || seq[2] === "Both_Explained")) return { complete: true, pathId: "P4_GP_One_FP_Success", score: scoreOf("P4_GP_One_FP_Success", 0.0) };
  if (seq.length >= 2 && oneOnly(seq[0]) && (!seq[1] || seq[1] === "NotSpecific")) return { complete: true, pathId: "P5_Spontaneous_One_FP_Fail", score: scoreOf("P5_Spontaneous_One_FP_Fail", -0.2) };
  if (seq.length >= 3 && seq[0] === "NotSpecific" && oneOnly(seq[1]) && (!seq[2] || seq[2] === "NotSpecific")) return { complete: true, pathId: "P6_GP_One_FP_Fail", score: scoreOf("P6_GP_One_FP_Fail", -1.0) };
  if (seq.length >= maxTurns) return { complete: true, pathId: "P7_None_Ever", score: scoreOf("P7_None_Ever", -2.5) };
  return { complete: false, score: 0 };
}
