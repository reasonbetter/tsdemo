/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AJInitPayload,
  DriverDecision,
  DriverProbe,
  ItemEnvelope,
  KernelPolicy,
  RngFn,
  SchemaEnvelope,
  ScorePayload,
  Json,
  ScoringSpecification,
  SkillDriver,
} from "@/types/kernel";

/* ---------------- Types ---------------- */
type BiasAnswerType =
  | "BiasPositive"
  | "BiasNegative"
  | "NotSpecific"
  | "NotClear"
  | "NotRelevant"
  | "NotPlausible"
  | "MultipleExplanation";

type ProbeDef = { id: string; text: string };

type BiasPolicy = {
  MaxClarificationAttempts: number;
  ConfidencePolicy: { MinAcceptConfidence: number };
  ClarificationPolicy?: { MaxTotal?: number; MaxConsecutiveNotSpecific?: number; MaxConsecutiveNotClear?: number };
};

type BiasState = {
  positive: boolean;
  negative: boolean;
  clarificationsUsed: number; // total elucidations (NotSpecific + NotClear)
  clarStreakType?: "NotSpecific" | "NotClear" | null;
  clarStreak?: number;
  usedProbeIDs: string[];
  distinctCount: number; // for kernel final scoring heuristic
  targetDistinct: number; // typically 2
  completed: boolean;
};

type AJOut = {
  AnswerType: BiasAnswerType;
  ThemeTag: string | null;
  Confidence: number;
  RecommendedProbeID?: string | null;
};

/* ---------------- Helpers ---------------- */
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const asNum = (v: any, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) || d : d);

function extractConfig(schema: SchemaEnvelope) {
  const dc: any = (schema as any).DriverConfig ?? schema;
  const ProbeLibrary: Record<string, ProbeDef[]> =
    (dc.ProbeLibrary as any) ??
    (dc.AJ_System_Guidance?.ProbeLibrary as any) ??
    {};

  // Route which probe category to use for each AnswerType (schema can override)
  const ProbeCategoryFor: Partial<Record<BiasAnswerType, string>> = {
    BiasPositive: dc?.ProbeCategoryFor?.BiasPositive ?? "OppositeFromPositive",
    BiasNegative: dc?.ProbeCategoryFor?.BiasNegative ?? "OppositeFromNegative",
    NotSpecific: dc?.ProbeCategoryFor?.NotSpecific ?? "NotSpecific",
    NotClear: dc?.ProbeCategoryFor?.NotClear ?? "NotClear",
    NotRelevant: dc?.ProbeCategoryFor?.NotRelevant ?? "NotRelevant",
    NotPlausible: dc?.ProbeCategoryFor?.NotPlausible ?? "NotPlausible",
    MultipleExplanation: dc?.ProbeCategoryFor?.MultipleExplanation ?? "MultipleExplanation",
  };

  // Optional mapping so authors/AJ can use local labels
  const AnswerTypeMap: Record<string, BiasAnswerType> = {
    ...(dc?.AnswerTypeMap ?? {}),
  };

  const AJ_System_Guidance = dc.AJ_System_Guidance ?? (schema as any).AJ_System_Guidance ?? "";
  const ConfidencePolicy = { MinAcceptConfidence: asNum(dc?.ConfidencePolicy?.MinAcceptConfidence, 0.6) };
  const MaxClarificationAttempts = asNum(dc?.MaxClarificationAttempts, 1);
  const ClarificationPolicy = {
    MaxTotal: asNum(dc?.ClarificationPolicy?.MaxTotal, 2),
    MaxConsecutiveNotSpecific: asNum(dc?.ClarificationPolicy?.MaxConsecutiveNotSpecific, 1),
    MaxConsecutiveNotClear: asNum(dc?.ClarificationPolicy?.MaxConsecutiveNotClear, 1),
  };

  // Scoring/targets
  const targetDistinct = asNum((schema as any)?.ScoringSpec?.TargetDistinctExplanations ?? dc?.TargetDistinctExplanations, 2);

  return { ProbeLibrary, ProbeCategoryFor, AnswerTypeMap, AJ_System_Guidance, ConfidencePolicy, MaxClarificationAttempts, ClarificationPolicy, targetDistinct };
}

function pickProbeIdForCategory(
  lib: Record<string, ProbeDef[]>, category: string, used: string[], recommended?: string | null
): { probe: DriverProbe | null; usedOut: string[] } {
  const group = lib[category] ?? [];
  if (recommended) {
    const cand = group.find(p => p.id === recommended);
    if (cand && !used.includes(cand.id)) return { probe: { id: cand.id, text: cand.text, category }, usedOut: used.concat(cand.id) };
  }
  const u = group.find(p => !used.includes(p.id)) ?? group[0];
  if (u) return { probe: { id: u.id, text: u.text, category }, usedOut: used.concat(u.id) };
  return { probe: null, usedOut: used.slice() };
}

/* ---------------- Driver ---------------- */
export const BiasDirectionDriver: SkillDriver<BiasState, BiasPolicy, ScoringSpecification, AJOut> = {
  id: "bias.direction.sequential.v1",
  kind: "bias.direction",
  version: "1.0.0",
  capabilities: { usesProbes: true, continuousScore: false, needsScenarioInTurn: false },

  buildAJInit(schema): AJInitPayload {
    const cfg = extractConfig(schema);
    return { system: cfg.AJ_System_Guidance, context: null };
  },

  initUnitState(schema): BiasState {
    const cfg = extractConfig(schema as SchemaEnvelope);
    return {
      positive: false,
      negative: false,
      clarificationsUsed: 0,
      usedProbeIDs: [],
      distinctCount: 0,
      targetDistinct: cfg.targetDistinct ?? 2,
      completed: false,
    };
  },

  migrateState(stored: Json): BiasState {
    const s = (stored as any) ?? {};
    const positive = !!s.positive;
    const negative = !!s.negative;
    const distinctCount = Number(s.distinctCount ?? (Number(positive) + Number(negative)));
    return {
      positive,
      negative,
      clarificationsUsed: Number(s.clarificationsUsed ?? 0),
      clarStreakType: (s.clarStreakType ?? null),
      clarStreak: Number(s.clarStreak ?? 0),
      usedProbeIDs: Array.isArray(s.usedProbeIDs) ? s.usedProbeIDs : [],
      distinctCount,
      targetDistinct: Number(s.targetDistinct ?? 2),
      completed: !!s.completed,
    };
  },

  parseAJOutput(raw: unknown, schema?: SchemaEnvelope, _item?: ItemEnvelope): AJOut {
    const obj = raw as any;
    const atRaw = String(obj?.AnswerType ?? "");
    const cfg = schema ? extractConfig(schema) : { AnswerTypeMap: {} } as any;
    const mapped: string = (cfg.AnswerTypeMap?.[atRaw] ?? atRaw);
    const allowed = ["BiasPositive","BiasNegative","NotSpecific","NotClear","NotRelevant","NotPlausible","MultipleExplanation"] as const;
    if (!(allowed as readonly string[]).includes(mapped)) throw new Error(`BiasDirection.parseAJOutput: invalid AnswerType '${atRaw}'`);
    return {
      AnswerType: mapped as BiasAnswerType,
      ThemeTag: obj?.ThemeTag == null ? null : String(obj.ThemeTag),
      Confidence: clamp01(asNum(obj?.Confidence, 0)),
      RecommendedProbeID: obj?.RecommendedProbeID == null ? null : String(obj.RecommendedProbeID),
    };
  },

  applyTurn({ schema, item, unitState, aj, policy }): DriverDecision<BiasState> {
    const cfg = extractConfig(schema);
    const st: BiasState = { ...(unitState as BiasState) };
    const itemProbeLibrary: Record<string, ProbeDef[]> = ((item as any)?.Content?.ProbeLibrary) ?? {};

    const minConf = asNum((policy as any)?.ConfidencePolicy?.MinAcceptConfidence ?? cfg.ConfidencePolicy.MinAcceptConfidence, 0.6);
    const maxClar = asNum((policy as any)?.MaxClarificationAttempts ?? cfg.MaxClarificationAttempts, 1);
    const cp = (cfg as any).ClarificationPolicy as { MaxTotal: number; MaxConsecutiveNotSpecific: number; MaxConsecutiveNotClear: number };

    let credited = 0;
    let score: ScorePayload | undefined;
    let budgetSignal: "productive" | "neutral" | "unproductive" = "unproductive";
    let probe: DriverProbe | null = null;

    const route = (answerType: BiasAnswerType): string => (cfg.ProbeCategoryFor as any)?.[answerType] ?? answerType;
    const choose = (category: string) => {
      const pick = pickProbeIdForCategory(itemProbeLibrary, category, st.usedProbeIDs, aj.RecommendedProbeID);
      st.usedProbeIDs = pick.usedOut;
      return pick.probe;
    };

    switch (aj.AnswerType) {
      case "MultipleExplanation":
        probe = choose(route("MultipleExplanation"));
        budgetSignal = "unproductive";
        break;

      case "NotRelevant":
      case "NotPlausible":
        probe = choose(route(aj.AnswerType));
        budgetSignal = "unproductive";
        break;

      case "NotSpecific": {
        const canTotal = st.clarificationsUsed < (cp?.MaxTotal ?? 2);
        const streak = (st.clarStreakType === "NotSpecific" ? (st.clarStreak ?? 0) : 0);
        const canStreak = streak < (cp?.MaxConsecutiveNotSpecific ?? 1);
        if (canTotal && canStreak) {
          probe = choose(route("NotSpecific"));
          st.clarificationsUsed += 1;
          st.clarStreakType = "NotSpecific";
          st.clarStreak = streak + 1;
          budgetSignal = "neutral";
        } else {
          probe = choose(route("NotPlausible"));
          st.clarStreakType = "NotSpecific";
          st.clarStreak = streak + 1;
          budgetSignal = "unproductive";
        }
        break;
      }

      case "NotClear": {
        const canTotal = st.clarificationsUsed < (cp?.MaxTotal ?? 2);
        const streak = (st.clarStreakType === "NotClear" ? (st.clarStreak ?? 0) : 0);
        const canStreak = streak < (cp?.MaxConsecutiveNotClear ?? 1);
        if (canTotal && canStreak) {
          probe = choose(route("NotClear"));
          st.clarificationsUsed += 1;
          st.clarStreakType = "NotClear";
          st.clarStreak = streak + 1;
          budgetSignal = "neutral";
        } else {
          probe = choose(route("NotPlausible"));
          st.clarStreakType = "NotClear";
          st.clarStreak = streak + 1;
          budgetSignal = "unproductive";
        }
        break;
      }

      case "BiasPositive": {
        if (aj.Confidence >= minConf && !st.positive) {
          st.positive = true;
          st.distinctCount = Number(st.positive) + Number(st.negative);
          credited = 1;
          score = { value: 1, label: "polytomous_increment" };
          budgetSignal = "productive";
          if (st.distinctCount < st.targetDistinct) {
            probe = choose(route("BiasPositive"));
          } else {
            probe = null;
          }
        } else {
          // Already accepted positive, or low confidence → treat as NotDistinct-like
          probe = choose(route("NotPlausible"));
          budgetSignal = "unproductive";
        }
        break;
      }

      case "BiasNegative": {
        if (aj.Confidence >= minConf && !st.negative) {
          st.negative = true;
          st.distinctCount = Number(st.positive) + Number(st.negative);
          credited = 1;
          score = { value: 1, label: "polytomous_increment" };
          budgetSignal = "productive";
          if (st.distinctCount < st.targetDistinct) {
            probe = choose(route("BiasNegative"));
          } else {
            probe = null;
          }
        } else {
          probe = choose(route("NotPlausible"));
          budgetSignal = "unproductive";
        }
        break;
      }
    }

    if (st.distinctCount >= st.targetDistinct) st.completed = true;

    return {
      credited,
      score,
      budgetSignal,
      probe,
      uiBadges: [
        `Dir+: ${st.positive ? "✔" : "✘"}`,
        `Dir-: ${st.negative ? "✔" : "✘"}`,
        `Clar: ${st.clarificationsUsed}`,
      ],
      completed: st.completed,
      telemetry: {
        last_answer_type: aj.AnswerType,
        distinct_count: st.distinctCount,
        target_distinct: st.targetDistinct,
      },
      newState: st,
      error_code: undefined,
    };
  },
};
