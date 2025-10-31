/* types/kernel.ts — central shared types */

/* ---------------- JSON primitives ---------------- */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type JSONSchema = boolean | { [key: string]: any };

/* ---------------- Θ (theta) vector ---------------- */
export type ThetaState = Record<string, { mean: number; var: number }>;

/* ----------------- Display Types ----------------- */
export type DisplayTheta = { mean: number; se: number };

/* ---------------- Configuration --------------- */
export interface KernelPolicy {
  TimeBudgetSec?: number;
  MaxConsecutiveFailedAttempts?: number;
  MaxTotalFailedAttempts?: number;
  [k: string]: unknown; // Allow other keys for driver-specific policies
}

export type ErrorMode = "log-error" | "percent" | "abs";
// Scoring helper specs used by drivers (e.g., GenericNumeric)
export type ThresholdsSpec = {
  // Error threshold for full credit (e.g., <= full -> 1.0)
  full: number;
  // Optional wider partial credit band (<= partial -> partialCredit)
  partial?: number;
  // Credit to award within partial band (defaulted in driver logic)
  partialCredit?: number;
};

export type RampSpec = {
  // Tolerance width that maps error to [0..1] via a decay ramp
  tolerance: number;
  // Optional exponent to change ramp curvature (1 = linear)
  shape?: number;
};

export type GaussianSpec = {
  // Standard deviation for exp(-0.5 * (err/sigma)^2)
  sigma: number;
};
export interface ScoringSpecification {
  target?: number;
  mode?: ErrorMode;
  thresholds?: ThresholdsSpec;
  ramp?: RampSpec;
  gaussian?: GaussianSpec;
  completion?: { closeEnough?: number; maxAttempts?: number };
  final?: {
    perDistinct?: Record<string, number>;
  };
  theta?: { step?: number; varDecay?: number; minVar?: number };
  [k: string]: unknown; // Allow other keys
}

/* ---------------- Envelopes ---------------------- */
export interface EngineConfig {
  driverId?: string;
  kind?: string;
  version?: string;
  [k: string]: unknown;
}

export interface SchemaEnvelope {
  SchemaID: string;
  Description?: string;
  GuidanceVersion: string;
  Engine?: EngineConfig;
  Ability?: { key?: string; keys?: string[] } & Record<string, unknown>;
  PolicyDefaults?: KernelPolicy;
  ScoringSpec?: ScoringSpecification;
  DriverConfig?: Json;
  ProbePolicy?: {
    AllowAJGeneratedFor?: string[];
    MaxGeneratedChars?: number;
    DisallowHintPatterns?: string[];
    [k: string]: unknown;
  };
  AJ_Contract_JsonSchema: JSONSchema; // may be object OR boolean
  [k: string]: unknown;
}

export interface ItemEnvelope {
  ItemID: string;
  SchemaID: string;
  Stem: string;
  DriverOverrides?: { Policy?: Partial<KernelPolicy>; Scoring?: Partial<ScoringSpecification>; [k: string]: unknown };
  Content?: Json;
  [k: string]: unknown;
}

export interface UnitStateEnvelope<TPayload = Json> {
  meta: {
    driverId: string;
    driverVersion: string;
    contractVersion: string; // from schema.GuidanceVersion
    schemaId: string;
    itemId: string;
    abilityKey: string;
    startedAtMs: number;
    turnCount: number;
    attempts?: number;
    consecutiveUnproductive?: number;
    totalUnproductive?: number;
  };
  payload: TPayload;
}

/* ---------------- Session snapshot --------------- */
// Shared label unions for transcript
export type DriverAnswerType =
  | 'Good'
  | 'NotDistinct'
  | 'NotSpecific'
  | 'NotClear'
  | 'NotRelevant'
  | 'NotPlausible'
  | 'RunsThroughA'
  | 'MultipleExplanation';

export type LegacyAssessmentLabel =
  | 'Correct'
  | 'Incomplete'
  | 'Flawed'
  | 'Incorrect'
  | 'Ambiguous'
  | 'Off_Topic';

export type TranscriptEntryLabel = 'kernel' | LegacyAssessmentLabel | DriverAnswerType;
export type TranscriptExchangeLabel = 'None' | TranscriptEntryLabel;

export interface TranscriptExchange {
  probe_text: string;
  probe_answer: string;
  label: TranscriptExchangeLabel;
}

export interface TranscriptEntry {
  item_id: string;
  text: string;
  answer: string;
  label: TranscriptEntryLabel;
  theta_state_before: ThetaState | DisplayTheta;
  exchanges: TranscriptExchange[];
  // For legacy data compatibility in admin view
  probe_text?: string;
  probe_answer?: string;
  probe_rationale?: string;
  final_score?: number;
  final_rationale?: string;
}

export interface SessionSnapshot {
  id: string;
  theta: ThetaState;
  currentItemId?: string | null;
  ajPriming?: Record<string, { guidanceVersion: string; primed: boolean }>;
  unit?: { driverId: string; state: UnitStateEnvelope; completed: boolean } | null;
  transcript?: TranscriptEntry[];
}

/* ---------------- API Contracts -------------------- */
export interface TurnRequestBody {
  sessionId: string;
  schemaId: string;
  itemId: string;
  userResponse?: string;
  probeResponse?: string;
  ajMeasurement?: unknown;
  twMeasurement?: unknown; // Legacy
}

export interface TurnResponseBody {
  ok: boolean;
  error?: string;
  probe: DriverProbe | null;
  completed: boolean;
  theta: ThetaState;
  unitState: UnitStateEnvelope;
  telemetry: Json;
  transcript: TranscriptEntry[];
}

/* ---------------- AJ payloads -------------------- */
export type AJInitPayload = { system: unknown; context: Json | null };
export type AJTurnScaffold = Json | null;

/* ---------------- Driver I/O types --------------- */
export type BudgetSignal = "productive" | "unproductive" | "neutral";

export interface DriverProbe {
  id: string | null; // null => generated by AJ
  text: string;
  category?: string; // e.g., "RunsThroughA", "too_high"
}

export interface ScorePayload {
  value: number; // 0..1 typical
  label?: string;
  components?: Record<string, Json>;
}

export interface DriverDecision<TState = Json> {
  credited?: number; // optional legacy credit value
  score?: ScorePayload; // recommended
  budgetSignal: BudgetSignal;
  probe?: DriverProbe | null;
  uiBadges?: string[];
  completed?: boolean;
  telemetry?: Json;
  newState: TState; // payload only (no envelope)
  error_code?: string;
}

export type RngFn = () => number;

export interface SkillDriver<
  TState = Json,
  TPolicy = KernelPolicy,
  TScoring = ScoringSpecification,
  TAJ = Json
> {
  id: string;
  kind?: string;
  version: string;
  capabilities?: DriverCapabilities;

  buildAJInit(schema: SchemaEnvelope, item?: ItemEnvelope): AJInitPayload;
  buildAJTurnScaffold?(schema: SchemaEnvelope, item?: ItemEnvelope): AJTurnScaffold;

  initUnitState(schema?: SchemaEnvelope, item?: ItemEnvelope): TState;
  migrateState?(stored: Json): TState;

  parseAJOutput(raw: unknown, schema?: SchemaEnvelope, item?: ItemEnvelope): TAJ;

  applyTurn(args: {
    schema: SchemaEnvelope;
    item: ItemEnvelope;
    unitState: TState;
    aj: TAJ;
    userText: string;
    policy: TPolicy;
    scoring: TScoring;
    rng: RngFn;
  }): DriverDecision<TState>;
}

// Shared driver capabilities advertised to the kernel/UI
export interface DriverCapabilities {
  // Driver may emit probes during applyTurn
  usesProbes?: boolean;
  // Driver emits a continuous score each turn (vs. completion-only)
  continuousScore?: boolean;
  // Driver needs scenario content in each turn call (not just init)
  needsScenarioInTurn?: boolean;
}
