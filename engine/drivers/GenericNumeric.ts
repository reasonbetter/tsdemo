/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AJInitPayload, AJTurnScaffold, DriverDecision, DriverProbe, Json, RngFn,
  ItemEnvelope, SchemaEnvelope, SkillDriver, ScorePayload, BudgetSignal, KernelPolicy, ScoringSpecification, ErrorMode
} from "@/types/kernel";

/* -------- Utility -------- */
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);
const asNum = (v: any, d = 0) => (isNum(v) ? v : typeof v === "string" ? (Number(v) ?? d) : d);
const toLowerNoSpace = (s: string) => s.toLowerCase().replace(/\s+/g, "");
function tryJSON(v: any): any { if (typeof v === "string") { try { return JSON.parse(v); } catch {} } return v; }

/* -------- Types -------- */
type ExtractStrategy = "aj" | "regex" | "either";
type ProbeCategory = "too_low" | "too_high" | "close_enough" | "good_continue" | "bad_format" | "unclear" | "complete";
type ProbeDef = { id: string; text: string };
type UnitsTable = { base: string; table: Record<string, number>; aliases?: Record<string, string> };

type ExtractionConfig = { strategy?: ExtractStrategy; regex?: string; flags?: string; pick?: "first"|"last"|"max"|"min" };

type ConfidencePolicy = { MinAcceptConfidence?: number };
type DriverConfig = {
  AJ_System_Guidance?: unknown;
  Extraction?: ExtractionConfig;
  Units?: UnitsTable;
  ProbeLibrary?: Partial<Record<ProbeCategory, ProbeDef[]>>;
  Budgets?: { TimeBudgetSec?: number; MaxConsecutiveFailedAttempts?: number }; // kernel-level; passed through
  ConfidencePolicy?: ConfidencePolicy;
};

type NumericState = {
  attempts: number;
  bestError: number | null;
  lastValue: number | null; // normalized
  completed: boolean;
};

/* -------- Defaults & helpers -------- */
const DEFAULT_AJ_SYSTEM = {
  role: "You are a measurement component. Extract exactly one numeric answer per turn, return JSON only.",
  return_format: { value: "number", unit: "string|null", normalized: "number|null", confidence: "number 0..1" },
  rules: [
    "If the user gives multiple numbers, pick the main final answer; ignore examples.",
    "Do not give advice or hints.",
    "Return only a JSON object; no prose."
  ]
};

const DEFAULT_PROBES: Record<ProbeCategory, ProbeDef[]> = {
  too_low:    [{ id: "low_1", text: "That seems low—try decomposing key parts." }],
  too_high:   [{ id: "high_1", text: "That seems high—establish reasonable bounds." }],
  close_enough:[{ id: "close_1", text: "Close—tighten once more." }],
  good_continue:[{ id: "good_1", text: "Good—try one more refinement." }],
  bad_format: [{ id: "fmt_1", text: "Please give one number (and unit if relevant)." }],
  unclear:    [{ id: "unclear_1", text: "I’m not sure which number you intend—provide one final number." }],
  complete:   [{ id: "done_1", text: "Thanks—that’s sufficient. Let’s move on." }],
};

function extractConfig(schema: SchemaEnvelope): DriverConfig {
  const dc: any = (schema as any).DriverConfig ?? schema;
  return {
    AJ_System_Guidance: dc.AJ_System_Guidance ?? (schema as any).AJ_System_Guidance ?? DEFAULT_AJ_SYSTEM,
    Extraction: {
      strategy: dc?.Extraction?.strategy ?? "either",
      regex: dc?.Extraction?.regex ?? "(?<value>\\b[0-9][0-9,\\.eE+-]*\\b)\\s*(?<unit>[A-Za-z/%]+)?",
      flags: dc?.Extraction?.flags ?? "i",
      pick: dc?.Extraction?.pick ?? "last",
    },
    Units: dc?.Units,
    ProbeLibrary: dc?.ProbeLibrary,
    Budgets: dc?.Budgets,
    ConfidencePolicy: dc?.ConfidencePolicy ?? {},
  };
}

function extractScoring(schema: SchemaEnvelope): ScoringSpecification {
  const s: any = (schema as any).ScoringSpec ?? schema;
  const thresholds: any | undefined = s?.thresholds;
  const ramp: any | undefined = s?.ramp;
  const gaussian: any | undefined = s?.gaussian;
  const completion = {
    closeEnough: s?.completion?.closeEnough ?? (thresholds?.full ?? (ramp ? 0.1 * Number(ramp.tolerance) : undefined)),
    maxAttempts: s?.completion?.maxAttempts ?? 1,
  };
  if (!Number.isFinite(Number(s?.target))) throw new Error("GenericNumeric: ScoringSpec.target is required.");
  return {
    target: Number(s.target),
    mode: (s.mode as ErrorMode) ?? "log-error",
    thresholds, ramp, gaussian, completion,
    theta: s.theta ?? { step: 0.25, varDecay: 0.9, minVar: 0.5 },
  } as ScoringSpecification;
}

function mergedProbes(cfg: DriverConfig): Record<ProbeCategory, ProbeDef[]> {
  const out: any = { ...DEFAULT_PROBES };
  const add = cfg.ProbeLibrary ?? {};
  for (const k of Object.keys(add) as ProbeCategory[]) {
    const arr = add[k];
    if (Array.isArray(arr) && arr.length > 0) out[k] = arr;
  }
  return out as Record<ProbeCategory, ProbeDef[]>;
}

function pickProbe(pool: Record<ProbeCategory, ProbeDef[]>, category: ProbeCategory): DriverProbe {
  const arr = pool[category] ?? [];
  const p = arr[0];
  return p ? { id: p.id, text: p.text, category } : { id: null, text: "Please refine your estimate.", category };
}

/* -------- Extraction & scoring -------- */
type AJNumeric = { value: number | null; unit?: string | null; normalized?: number | null; confidence?: number | null };

function parseAJOutputNumeric(raw: any): AJNumeric | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw, unit: null, normalized: null, confidence: null };
  if (typeof raw === "object") {
    const obj = tryJSON(raw);
    const direct = (obj as any).value ?? (obj as any).normalized ?? (obj as any).answer ?? (obj as any).num;
    const unit = (obj as any).unit ?? null;
    const norm = (obj as any).normalized ?? null;
    const conf = (obj as any).confidence ?? (obj as any).Confidence ?? null;
    if (direct != null && !Number.isNaN(Number(direct))) {
      return {
        value: Number(direct),
        unit: unit != null ? String(unit) : null,
        normalized: norm != null && Number.isFinite(Number(norm)) ? Number(norm) : null,
        confidence: conf != null ? Number(conf) : null,
      };
    }
    if (obj.NumericAnswer) return parseAJOutputNumeric(obj.NumericAnswer);
  }
  return null;
}

function normalizeUnit(units: UnitsTable | undefined, value: number, unit: string | null | undefined): number {
  if (!units) return value;
  if (!unit) return value;
  const aliased = units.aliases?.[toLowerNoSpace(unit)] ?? toLowerNoSpace(unit);
  const mult = units.table[aliased];
  if (typeof mult === "number" && Number.isFinite(mult)) return value * mult;
  if (aliased === toLowerNoSpace(units.base)) return value;
  return value;
}

function extractNumberWithRegex(text: string, ex: ExtractionConfig): { value: number; unit: string | null } | null {
  const re = new RegExp(ex.regex ?? "(?<value>\\b[0-9][0-9,\\.eE+-]*\\b)\\s*(?<unit>[A-Za-z/%]+)?", ex.flags ?? "i");
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;

  const pick = ex.pick ?? "last";
  let candidate: RegExpMatchArray | null = null;

  switch (pick) {
    case "first": candidate = matches[0]; break;
    case "last": candidate = matches[matches.length - 1]; break;
    case "max":
    case "min": {
      const nums = matches
        .map((m) => {
          const raw = (m.groups?.value ?? m[1] ?? "").toString().replace(/,/g, "");
          const n = Number(raw);
          return { m, n };
        })
        .filter((z) => Number.isFinite(z.n));
      if (nums.length === 0) return null;
      nums.sort((a, b) => (pick === "max" ? b.n - a.n : a.n - b.n));
      candidate = nums[0].m;
      break;
    }
  }

  if (!candidate) return null;

  const raw = (candidate.groups?.value ?? candidate[1] ?? "").toString().replace(/,/g, "");
  const unit = candidate.groups?.unit ?? null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return { value: n, unit };
}

function computeError(x: number, target: number, mode: ErrorMode): { err: number; sign: number } {
  if (mode === "abs") {
    const d = x - target; return { err: Math.abs(d), sign: Math.sign(d) };
  }
  if (mode === "percent") {
    if (target === 0) { const d = x - target; return { err: Math.abs(d), sign: Math.sign(d) }; }
    const d = x - target; return { err: Math.abs(d) / Math.abs(target), sign: Math.sign(d) };
  }
  if (x <= 0 || target <= 0) { const d = x - target; return { err: Math.abs(d), sign: Math.sign(d) }; }
  const le = Math.abs(Math.log10(x) - Math.log10(target));
  const sign = Math.log10(x) - Math.log10(target) >= 0 ? 1 : -1;
  return { err: le, sign };
}

function creditFromError(err: number, spec: ScoringSpecification): number {
  if (spec.thresholds) {
    const full = spec.thresholds.full;
    const partial = spec.thresholds.partial;
    const partialCredit = spec.thresholds.partialCredit ?? 0.5;
    if (err <= full) return 1;
    if (typeof partial === "number") return err <= partial ? partialCredit : 0;
    if (err <= 2 * full) return clamp01(1 - (err - full) / full);
    return 0;
  }
  if (spec.ramp) {
    const t = (err / spec.ramp.tolerance);
    const shape = spec.ramp.shape ?? 1;
    return clamp01(1 - Math.pow(clamp01(t), shape));
  }
  if (spec.gaussian) {
    const z = err / spec.gaussian.sigma;
    return clamp01(Math.exp(-0.5 * z * z));
  }
  if (err <= 1) return clamp01(1 - 0.5 * err);
  return 0;
}

/* -------- Driver -------- */
export const GenericNumericDriver: SkillDriver<NumericState, KernelPolicy, ScoringSpecification, any> = {
  id: "generic.numeric.v1",
  kind: "generic.numeric",
  version: "1.1.0",
  capabilities: { usesProbes: true, continuousScore: true, needsScenarioInTurn: false },

  buildAJInit(schema) {
    const cfg = extractConfig(schema);
    return { system: cfg.AJ_System_Guidance ?? DEFAULT_AJ_SYSTEM, context: null };
  },
  buildAJTurnScaffold() { return null; },

  initUnitState() {
    return { attempts: 0, bestError: null, lastValue: null, completed: false };
  },
  migrateState(stored: Json) {
    const s = (stored as any) ?? {};
    return { attempts: Number(s.attempts ?? 0), bestError: s.bestError ?? null, lastValue: s.lastValue ?? null, completed: !!s.completed };
  },

  parseAJOutput(raw): any { return raw as any; },

  applyTurn({ schema, item, unitState, aj, userText, policy, scoring, rng }): DriverDecision<NumericState> {
    const cfg = extractConfig(schema);
    const probes = mergedProbes(cfg);
    const st: NumericState = { ...(unitState as NumericState) };

    if (typeof scoring.target !== 'number') {
      throw new Error("GenericNumericDriver: ScoringSpec requires a 'target' number.");
    }

    if (!scoring.mode) {
      throw new Error("GenericNumericDriver: ScoringSpec requires a 'mode' property.");
    }

    // 1) Extract numeric
    let source: "aj" | "regex" | "none" = "none";
    let parsed = null as AJNumeric | null;
    if ((cfg.Extraction?.strategy ?? "either") !== "regex") {
      parsed = parseAJOutputNumeric(aj);
      if (parsed && (parsed.normalized != null || parsed.value != null)) source = "aj";
    }

    let valueNorm: number | null = null;
    if (source === "aj" && parsed) {
      const candidate = parsed.normalized ?? parsed.value!;
      if (Number.isFinite(candidate)) valueNorm = normalizeUnit(cfg.Units, candidate, parsed.unit ?? null);
      const minConf = Number(cfg.ConfidencePolicy?.MinAcceptConfidence ?? 0);
      if (!(Number.isFinite(valueNorm as number)) || (parsed.confidence != null && parsed.confidence < minConf)) {
        if ((cfg.Extraction?.strategy ?? "either") !== "aj") source = "none";
      }
    }
    if (source !== "aj") {
      if ((cfg.Extraction?.strategy ?? "either") !== "aj") {
        const rx = extractNumberWithRegex(userText ?? "", cfg.Extraction ?? {});
        if (rx) { valueNorm = normalizeUnit(cfg.Units, rx.value, rx.unit); source = "regex"; }
      }
    }

    // No numeric value -> unproductive
    if (valueNorm == null || !Number.isFinite(valueNorm)) {
      st.attempts += 1;
      const probe = pickProbe(probes, "bad_format");
      return {
        credited: 0,
        score: { value: 0, label: "format" },
        budgetSignal: "unproductive",
        probe,
        uiBadges: ["Numeric: Unreadable"],
        completed: false,
        telemetry: { Source: source, Parsed: parsed, Reason: "no_numeric_value", Attempts: st.attempts },
        newState: st,
        error_code: "NO_NUMERIC_VALUE",
      };
    }

    // 2) Error & credit
    const { err, sign } = computeError(valueNorm, scoring.target, scoring.mode);
    const credit = creditFromError(err, scoring);

    st.attempts += 1;
    st.lastValue = valueNorm;
    st.bestError = st.bestError == null ? err : Math.min(st.bestError, err);

    const closeEnough = scoring.completion?.closeEnough;
    const hitClose = typeof closeEnough === "number" ? err <= closeEnough : false;

    // 3) Probe selection
    let category: ProbeCategory;
    if (hitClose) category = "complete";
    else if (credit >= 0.9) category = "close_enough";
    else if (credit > 0) category = "good_continue";
    else category = sign < 0 ? "too_low" : "too_high";

    const probe = pickProbe(probes, category);

    // 4) Budget signal & completion
    const budgetSignal: BudgetSignal = credit > 0 ? "productive" : "unproductive";
    const completed = hitClose || false; // kernel may still force-complete on budgets

    const score: ScorePayload = { value: clamp01(credit), label: scoring.mode, components: { error: err } };

    return {
      credited: credit,
      score,
      budgetSignal,
      probe,
      uiBadges: [`Numeric: ${valueNorm}`, `Error(${scoring.mode}): ${+err.toFixed(4)}`, `Credit: ${+credit.toFixed(3)}`],
      completed,
      telemetry: {
        Source: source, Parsed: parsed, NormalizedValue: valueNorm, Target: scoring.target, Mode: scoring.mode,
        Error: err, Credit: credit, Attempts: st.attempts
      },
      newState: st,
      error_code: undefined,
    };
  },
};
