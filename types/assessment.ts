// types/assessment.ts

// --- Item Bank Structures ---

export interface SchemaFeatures {
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

export type AJLabel = 'Correct' | 'Incomplete' | 'Flawed' | 'Incorrect' | 'Ambiguous' | 'Off_Topic' | 'None';
export type ProbeIntent = 'None' | 'Completion' | 'Improvement' | 'Alternative' | 'Clarify' | 'Boundary';

// --- Configuration Structures ---

// Type for data/config.json
export interface AssessmentConfig {
  CFG: {
    score_correct_threshold: number;
    tau_complete: number;
    tau_required_move: number;
    tau_pitfall_hi: number;
    tau_confidence: number;
    coverage_targets: CoverageTag[];
  };
}

// Type for data/probeLibrary.json
export type ProbeLibrary = Record<ProbeIntent, string[]>;


// The structured output from the Adaptive Judge
export interface AJJudgment {
  score: number; // A single score from 0.0 to 1.0
  label: AJLabel; // The final categorical label
  rationale?: string; // A short explanation for the score/label
  probe?: { // Optional probe object from the first pass
    intent: ProbeIntent;
    text: string;
    rationale?: string;
  };
  tags?: string[]; // Optional tags from the first pass
}

// --- Orchestrator (Turn) Structures ---

// The response sent back to the client after a turn
export interface TurnResult {
  final_label: AJLabel;
  probe_type: ProbeIntent;
  probe_text: string; // The text of the probe to ask the user
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
  probe_rationale?: string;
  initial_score?: number;
  initial_tags?: string[];
  theta_state_before?: ThetaState;
  probe_answer?: string;
  final_score?: number;
  final_rationale?: string;
}

// InMemorySession is removed.

export interface LogEntry {
  ts: string;
  session_id: string | null;
  user_tag: string | null;
  type: string;
  [key: string]: any;
}
