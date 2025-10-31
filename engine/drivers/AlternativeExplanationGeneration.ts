/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AJInitPayload, AJTurnScaffold, DriverDecision, DriverProbe,
  ItemEnvelope, SchemaEnvelope, SkillDriver, Json, ScorePayload, BudgetSignal, KernelPolicy, ScoringSpecification, RngFn
} from "@/types/kernel";

/* ---------------- Internal types ---------------- */
type AnswerType =
  | "Good" | "NotDistinct" | "NotSpecific" | "NotClear" | "NotRelevant"
  | "NotPlausible" | "MultipleExplanation" | "RunsThroughA";

type ThemeRegistryEntry = { ThemeID: string; Aliases?: string[]; NearMisses?: string[]; Examples?: string[] };
type ScenarioDefinition = { A_text?: string; B_text?: string };
type ProbeDef = { id: string; text: string };

type AEGPolicy = {
  MaxClarificationAttempts: number;
  ConfidencePolicy: { GoodAcceptanceMinConfidence: number; NovelAcceptanceMinConfidence: number };
};

type AEGScoring = {
  type: "polytomous_map" | string;
  maps?: Record<string, { score: number; criteria: string }[]>;
  default?: { TargetDistinctExplanations?: number; ScoringMapID?: string };
  TargetDistinctExplanations?: number;
  ScoringMapID?: string;
  theta?: { step?: number; varDecay?: number; minVar?: number }; // used by ThetaService
};

type AEGState = {
  acceptedThemeTags: string[];
  distinctCount: number;
  usedProbeIDs: string[];
  clarificationsUsed: number; // total elucidations (NotSpecific + NotClear)
  clarStreakType?: "NotSpecific" | "NotClear" | null;
  clarStreak?: number;
  targetDistinct: number;
  scoringMapID: string;
  completed: boolean;
};

type AJOut = {
  AnswerType: AnswerType;
  ThemeTag: string | null;
  Confidence: number;
  RecommendedProbeID?: string | null;
  GeneratedProbeText?: string | null;
};

/* ---------------- Helpers & shims --------------- */
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const asNum = (v: any, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) || d : d);
const isKnownTheme = (tag: string | null, reg?: ThemeRegistryEntry[]) => !!tag && !!reg?.find(t => t.ThemeID === tag);
const isNovel = (tag: string | null) => !!tag && /^NOVEL:/i.test(tag);

function extractContent(item: ItemEnvelope) {
  const c: any = (item as any).Content ?? item;
  return {
    ScenarioDefinition: c.ScenarioDefinition as ScenarioDefinition | undefined,
    ThemeRegistry: c.ThemeRegistry as ThemeRegistryEntry[] | undefined,
    TooGeneral: c.TooGeneral as string[] | undefined,
    ProbeLibrary: c.ProbeLibrary as Record<string, ProbeDef[]> | undefined,
  };
}

function extractConfig(schema: SchemaEnvelope) {
  const dc: any = (schema as any).DriverConfig ?? schema;
  const DominanceOrder: AnswerType[] =
    (dc.DominanceOrder as any) ??
    (dc.AJ_System_Guidance?.DominanceOrder as any) ??
    [
      "MultipleExplanation", "RunsThroughA", "NotRelevant", "NotDistinct", "NotClear", "NotSpecific", "NotPlausible",
    ];
  const AJ_System_Guidance = dc.AJ_System_Guidance ?? (schema as any).AJ_System_Guidance ?? "";
  const ConfidencePolicy = {
    GoodAcceptanceMinConfidence: asNum(dc?.ConfidencePolicy?.GoodAcceptanceMinConfidence ?? (schema as any)?.DO_Policy_Defaults?.ConfidencePolicy?.GoodAcceptanceMinConfidence, 0.6),
    NovelAcceptanceMinConfidence: asNum(dc?.ConfidencePolicy?.NovelAcceptanceMinConfidence ?? (schema as any)?.DO_Policy_Defaults?.ConfidencePolicy?.NovelAcceptanceMinConfidence, 0.75),
  };
  const MaxClarificationAttempts = asNum(dc?.MaxClarificationAttempts ?? (schema as any)?.DO_Policy_Defaults?.MaxClarificationAttempts, 1);
  const ClarificationPolicy = {
    MaxTotal: asNum(dc?.ClarificationPolicy?.MaxTotal, 2),
    MaxConsecutiveNotSpecific: asNum(dc?.ClarificationPolicy?.MaxConsecutiveNotSpecific, 1),
    MaxConsecutiveNotClear: asNum(dc?.ClarificationPolicy?.MaxConsecutiveNotClear, 1),
  };
  // Aliasing support: map schema-specific AnswerType → canonical behavior
  const AnswerTypeMap: Record<string, string> = { ...(dc?.AnswerTypeMap ?? {}) };
  // Back-compat convenience: allow schemas to alias friendlier labels to RunsThroughA
  if (!AnswerTypeMap["RejectsPremise"]) AnswerTypeMap["RejectsPremise"] = "RunsThroughA";
  const RunsThroughCategoryLabel: string = typeof dc?.GeneratedProbeCategoryLabel === 'string'
    ? String(dc.GeneratedProbeCategoryLabel)
    : "RunsThroughA"; // reuse existing key to minimize schema churn

  return { DominanceOrder, AJ_System_Guidance, ConfidencePolicy, MaxClarificationAttempts, ClarificationPolicy, AnswerTypeMap, RunsThroughCategoryLabel };
}

function extractScoring(schema: SchemaEnvelope, item: ItemEnvelope): AEGScoring {
  const s: any = (schema as any).ScoringSpec ?? {};
  const defaults = s.default ?? {};
  const itemTarget = (item as any)?.DriverOverrides?.Policy?.TargetDistinctExplanations ?? (item as any)?.DO_Policy?.TargetDistinctExplanations;
  const itemMapID = (item as any)?.DriverOverrides?.Policy?.ScoringMapID ?? (item as any)?.DO_Policy?.ScoringMapID;
  return {
    type: (s.type as string) ?? "polytomous_map",
    maps: s.maps ?? (schema as any)?.DO_Policy_Defaults?.ScoringMapLibrary ?? {},
    default: s.default,
    TargetDistinctExplanations: itemTarget ?? (s.TargetDistinctExplanations ?? defaults.TargetDistinctExplanations ?? 2),
    ScoringMapID: itemMapID ?? (s.ScoringMapID ?? defaults.ScoringMapID ?? "Map_2Expl"),
    theta: s.theta ?? { step: 0.25, varDecay: 0.9, minVar: 0.5 },
  };
}

function pickProbeIdForCategory(
  lib: Record<string, ProbeDef[]>, category: string, used: string[], recommended?: string | null
): { probe: DriverProbe | null; usedOut: string[]; overridden: boolean } {
  const group = lib[category] ?? [];
  // honor AJ recommendation if valid and unused
  if (recommended) {
    const cand = group.find(p => p.id === recommended);
    if (cand && !used.includes(cand.id)) return { probe: { id: cand.id, text: cand.text, category }, usedOut: used.concat(cand.id), overridden: false };
  }
  // pick first unused else reuse first
  const u = group.find(p => !used.includes(p.id)) ?? group[0];
  if (u) return { probe: { id: u.id, text: u.text, category }, usedOut: used.concat(u.id), overridden: !!recommended };
  // fallback generic
  return { probe: { id: null, text: "Please provide one clear explanation.", category }, usedOut: used.slice(), overridden: !!recommended };
}

/* ---------------- Driver ---------------- */
export const AlternativeExplanationGenerationDriver: SkillDriver<AEGState, AEGPolicy, AEGScoring, AJOut> = {
  id: "aeq.aeg.v1",
  kind: "aeg",
  version: "1.1.0",
  capabilities: { usesProbes: true, continuousScore: false, needsScenarioInTurn: false },

  buildAJInit(schema, item?): AJInitPayload {
    const cfg = extractConfig(schema);
    const content = item ? extractContent(item) : undefined;
    return { system: cfg.AJ_System_Guidance, context: content?.ScenarioDefinition ?? null };
  },

  buildAJTurnScaffold() { return null; },

  initUnitState(schema, item): AEGState {
    if (!schema || !item) throw new Error("AEG Driver requires schema and item to initialize.");
    const sc = extractScoring(schema, item);
    return {
      acceptedThemeTags: [],
      distinctCount: 0,
      usedProbeIDs: [],
      clarificationsUsed: 0,
      targetDistinct: sc.TargetDistinctExplanations ?? 2,
      scoringMapID: sc.ScoringMapID ?? "Map_2Expl",
      completed: false,
    };
  },

  migrateState(stored: Json): AEGState {
    const p = (stored as any) ?? {};
    return {
      acceptedThemeTags: Array.isArray(p.acceptedThemeTags) ? p.acceptedThemeTags : [],
      distinctCount: Number(p.distinctCount ?? (Array.isArray(p.acceptedThemeTags) ? p.acceptedThemeTags.length : 0)),
      usedProbeIDs: Array.isArray(p.usedProbeIDs) ? p.usedProbeIDs : [],
      clarificationsUsed: Number(p.clarificationsUsed ?? 0),
      clarStreakType: (p.clStreakType ?? p.clarStreakType) ?? null,
      clarStreak: Number(p.clarStreak ?? 0),
      targetDistinct: Number(p.targetDistinct ?? 2),
      scoringMapID: String(p.scoringMapID ?? "Map_2Expl"),
      completed: !!p.completed,
    };
  },

  parseAJOutput(raw: unknown, schema?: SchemaEnvelope, _item?: ItemEnvelope): AJOut {
    const obj = raw as any;
    const rawAt = String(obj?.AnswerType ?? "");
    const cfg = schema ? extractConfig(schema) : { AnswerTypeMap: {} } as any;
    // Map schema-specific label → canonical behavior
    const mapped = (cfg.AnswerTypeMap?.[rawAt] ?? rawAt) as string;
    const allowedCanon = ["Good","NotDistinct","NotSpecific","NotClear","NotRelevant","NotPlausible","MultipleExplanation","RunsThroughA"] as const;
    if (!(allowedCanon as readonly string[]).includes(mapped)) {
      throw new Error(`AEG.parseAJOutput: invalid AnswerType '${rawAt}' (mapped to '${mapped}')`);
    }
    return {
      AnswerType: mapped as AnswerType,
      ThemeTag: obj?.ThemeTag == null ? null : String(obj.ThemeTag),
      Confidence: clamp01(asNum(obj?.Confidence, 0)),
      RecommendedProbeID: obj?.RecommendedProbeID == null ? null : String(obj.RecommendedProbeID),
      GeneratedProbeText: obj?.GeneratedProbeText == null ? null : String(obj.GeneratedProbeText),
    };
  },

  applyTurn({ schema, item, unitState, aj, policy, scoring }: { schema: SchemaEnvelope; item: ItemEnvelope; unitState: AEGState; aj: AJOut; userText: string; policy: KernelPolicy; scoring: ScoringSpecification; rng: RngFn; }): DriverDecision<AEGState> {
    const cfg = extractConfig(schema);
    const content = extractContent(item);
    const st: AEGState = { ...(unitState as AEGState) };
    const sc: AEGScoring = scoring as any;
    const itemProbeLibrary: Record<string, ProbeDef[]> = (content as any)?.ProbeLibrary ?? {};

    // Ensure target/map reflect latest overrides (don’t reduce distinctCount)
    st.targetDistinct = sc.TargetDistinctExplanations ?? st.targetDistinct ?? 2;
    st.scoringMapID = sc.ScoringMapID ?? st.scoringMapID ?? "Map_2Expl";

    const maxClar = Number((policy as any)?.MaxClarificationAttempts ?? cfg.MaxClarificationAttempts ?? 1);
    const cp = (cfg as any).ClarificationPolicy as { MaxTotal: number; MaxConsecutiveNotSpecific: number; MaxConsecutiveNotClear: number };
    const confGood = Number((policy as any)?.ConfidencePolicy?.GoodAcceptanceMinConfidence ?? cfg.ConfidencePolicy.GoodAcceptanceMinConfidence);
    const confNovel = Number((policy as any)?.ConfidencePolicy?.NovelAcceptanceMinConfidence ?? cfg.ConfidencePolicy.NovelAcceptanceMinConfidence);

    // Normalize anomalies: Good must carry ThemeTag
    let at: AnswerType = aj.AnswerType;
    let themeTag = aj.ThemeTag;
    const conf = aj.Confidence;

    if (at === "Good" && (!themeTag || themeTag.trim() === "")) at = "NotSpecific";
    if (at === "Good" && themeTag && st.acceptedThemeTags.includes(themeTag)) at = "NotDistinct";

    let credited = 0;
    let score: ScorePayload | undefined;
    let probe: DriverProbe | null = null;
    let budgetSignal: BudgetSignal = "unproductive";
    const badges: string[] = [`AnswerType: ${at}`];

    const categoryProbe = (category: string) => {
      const pick = pickProbeIdForCategory(itemProbeLibrary, category, st.usedProbeIDs, aj.RecommendedProbeID);
      if (pick.probe?.id) st.usedProbeIDs = pick.usedOut;
      return pick.probe;
    };

    const scenario = content.ScenarioDefinition ?? {};
    const runsThroughAFallback = () =>
      `Please avoid relying on ‘${scenario.A_text ?? "A"}’ causing ‘${scenario.B_text ?? "B"}’. Try a different explanation.`;

    switch (at) {
      case "MultipleExplanation":
        probe = categoryProbe("MultipleExplanation");
        budgetSignal = "unproductive";
        break;

      case "RunsThroughA": {
        const cat = (cfg as any).RunsThroughCategoryLabel as string;
        probe = categoryProbe(cat || "RunsThroughA");
        budgetSignal = "unproductive";
        break;
      }

      case "NotRelevant":
      case "NotPlausible":
        probe = categoryProbe(at);
        budgetSignal = "unproductive";
        break;

      case "NotClear": {
        if (st.clarificationsUsed < maxClar) {
          probe = categoryProbe("NotClear");
          st.clarificationsUsed += 1;
          budgetSignal = "neutral"; // Treat like NotSpecific for clarification
        } else {
          probe = categoryProbe("NotPlausible");
          budgetSignal = "unproductive";
        }
        break;
      }

      case "NotSpecific": {
        const canTotal = st.clarificationsUsed < (cp?.MaxTotal ?? 2);
        const streak = (st.clarStreakType === "NotSpecific" ? (st.clarStreak ?? 0) : 0);
        const canStreak = streak < (cp?.MaxConsecutiveNotSpecific ?? 1);
        if (canTotal && canStreak) {
          probe = categoryProbe("NotSpecific");
          st.clarificationsUsed += 1;
          st.clarStreakType = "NotSpecific";
          st.clarStreak = streak + 1;
          budgetSignal = "neutral";
        } else {
          probe = categoryProbe("NotPlausible");
          st.clarStreakType = "NotSpecific";
          st.clarStreak = streak + 1;
          budgetSignal = "unproductive";
        }
        break;
      }

      case "NotDistinct":
        probe = categoryProbe("NotDistinct");
        budgetSignal = "unproductive"; // Always unproductive
        if (themeTag) badges.push(`Theme: ${themeTag}`);
        break;

      case "Good": {
        if (!themeTag) {
          probe = categoryProbe("NotSpecific");
          const streak = (st.clarStreakType === "NotSpecific" ? (st.clarStreak ?? 0) : 0);
          st.clarificationsUsed += 1;
          st.clarStreakType = "NotSpecific";
          st.clarStreak = streak + 1;
          budgetSignal = "neutral";
          break;
        }
        const novel = isNovel(themeTag);
        const known = !novel && isKnownTheme(themeTag, content.ThemeRegistry);

        const acceptKnown = known && conf >= confGood;
        const acceptNovel = novel && conf >= confNovel;

        if (acceptKnown || acceptNovel) {
          credited = 1;
          score = { value: 1, label: "polytomous_increment" };
          if (!st.acceptedThemeTags.includes(themeTag)) {
            st.acceptedThemeTags.push(themeTag);
            st.distinctCount = st.acceptedThemeTags.length;
          }
          budgetSignal = "productive";
          badges.push(`Theme: ${themeTag}`);

          // Only prompt again if target not reached
          if (st.distinctCount < st.targetDistinct) probe = categoryProbe("Good");
          else probe = null;
        } else {
          // Low confidence or unrecognized
          if (st.clarificationsUsed < maxClar) {
            probe = categoryProbe("NotSpecific");
            st.clarificationsUsed += 1;
            budgetSignal = "neutral";
          } else {
            probe = categoryProbe("NotPlausible");
            budgetSignal = "unproductive";
          }
          badges.push(`Theme: ${themeTag}`);
        }
        break;
      }
      case "NotClear": {
        const canTotal = st.clarificationsUsed < (cp?.MaxTotal ?? 2);
        const streak = (st.clarStreakType === "NotClear" ? (st.clarStreak ?? 0) : 0);
        const canStreak = streak < (cp?.MaxConsecutiveNotClear ?? 1);
        if (canTotal && canStreak) {
          probe = categoryProbe("NotClear");
          st.clarificationsUsed += 1;
          st.clarStreakType = "NotClear";
          st.clarStreak = streak + 1;
          budgetSignal = "neutral";
        } else {
          probe = categoryProbe("NotPlausible");
          st.clarStreakType = "NotClear";
          st.clarStreak = streak + 1;
          budgetSignal = "unproductive";
        }
        break;
      }
    }

    // Domain completion
    if (st.distinctCount >= st.targetDistinct) st.completed = true;

    return {
      credited,
      score,
      budgetSignal,
      probe,
      uiBadges: badges,
      completed: st.completed,
      telemetry: {
        ThemeTag: themeTag ?? null,
        Confidence: conf,
        DistinctCount: st.distinctCount,
        TargetDistinct: st.targetDistinct,
      },
      newState: st,
      error_code: undefined,
    };
  },
};
