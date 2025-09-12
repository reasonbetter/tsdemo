// types/assessment.ts

// --- Item Bank Structures ---

export interface SchemaFeatures {
  family: string;
  coverage_tag: CoverageTag;
  required_moves?: string[];
  // Natural language guidance for the AJ (New Requirement)
  aj_guidance?: string;
}

export type CoverageTag = 'confounding' | 'temporality' | 'complexity' | string;

export interface ItemInstance {
  item_id: string;
  schema_id: string;
  a: number; // Discrimination (IRT parameter)
  b: number; // Difficulty (IRT parameter)
  band: string;
  text: string;
}

export interface ItemBank {
  schema_features: Record<string, SchemaFeatures>;
  items: ItemInstance[];
}

// --- Adaptive Judge (AJ) Structures ---

export type AJLabel = 'Correct&Complete' | 'Correct_Missing' | 'Correct_Flawed' | 'Partial' | 'Incorrect' | 'Novel';
export type ProbeIntent = 'None' | 'Completion' | 'Mechanism' | 'Alternative' | 'Clarify' | 'Boundary';

// --- Configuration Structures ---

// Type for data/config.json
export interface AssessmentConfig {
  CFG: {
    tau_complete: number;
    tau_required_move: number;
    tau_pitfall_hi: number;
    tau_confidence: number;
    enable_c6_patch: boolean;
    coverage_targets: CoverageTag[];
    score_map: Record<AJLabel, number>;
  };
  BANNED_TOKENS: string[];
}

// Type for data/probeLibrary.json
export type ProbeLibrary = Record<ProbeIntent, string[]>;


// The structured output from the Adaptive Judge
export interface AJJudgment {
  score: number; // A single score from 0.0 to 1.0
  final_label: AJLabel; // The final categorical label  
  pitfalls: string[]; // A list of observed pitfall tags
  process_moves: string[]; // A list of observed process move tags
 
  // The AJ's generated probe recommendation
  probe: {
    intent: ProbeIntent;
    text: string;
    rationale: string;
    confidence: number;
  };
  // Specific to Transcript Windows (TW) - used in the orchestrator merge logic
  tw_labels?: Record<string, number>;
}

// Input features provided to the AJ
export interface AJFeatures {
  schema_id: string;
  item_id: string;
  band: string;
  item_params: { a: number; b: number };
  expect_direction_word: boolean;
  expected_list_count?: number;
  tw_type: ProbeIntent | null;
  // The guidance paragraph passed dynamically (New Requirement)
  aj_guidance?: string;
}


// --- Orchestrator (Turn) Structures ---

// The response sent back to the client after a turn
export interface TurnResult {
  final_label: AJLabel;
  probe_type: ProbeIntent;
  probe_text: string;
  probe_source?: string;
  next_item_id: string | null;
  theta_mean: number;
  theta_var: number;
  coverage_counts: Record<string, number>;
  trace: string[];
}

// --- Session State & Logging ---

export interface ThetaState {
  mean: number;
  se: number; // Standard Error (derived from variance)
}

export interface HistoryEntry {
  item_id: string;
  text: string;
  answer: string;
  label: AJLabel;
  probe_type: ProbeIntent;
  probe_text: string;
  trace: string[];
  pitfalls?: Record<string, number>;
  process_moves?: Record<string, number>;
  theta_mean?: number;
  theta_var?: number;
  probe_answer?: string;
  probe_label?: ProbeIntent;
  probe_theta_update?: { mean: number; var: number; };
}

// InMemorySession is removed.

export interface LogEntry {
  ts: string;
  session_id: string | null;
  user_tag: string | null;
  type: string;
  [key: string]: any;
}
