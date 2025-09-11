// Minimal orchestrator API: policy, theta update, next-item selection
import type { NextApiRequest, NextApiResponse } from 'next';
// Import the externalized data files
import bankData from "@/data/itemBank.json";
import configData from "@/data/config.json";
import probeLibraryData from "@/data/probeLibrary.json";

import {
  ItemBank,
  ItemInstance,
  AJJudgment,
  AJLabel,
  ProbeIntent,
  SchemaFeatures,
  InMemorySession,
  TurnResult,
  CoverageTag,
  AssessmentConfig,
  ProbeLibrary
} from '@/types/assessment';

// Type assertion for the imported JSON data
const bank: ItemBank = bankData as ItemBank;
const CONFIG: AssessmentConfig = configData as AssessmentConfig;
const PROBE_LIBRARY: ProbeLibrary = probeLibraryData as ProbeLibrary;

// Extract configuration constants from the imported config
const { CFG, BANNED_TOKENS } = CONFIG;


interface Probe {
  intent: ProbeIntent;
  text: string;
  rationale?: string;
  confidence?: number;
  source: 'policy' | 'AJ' | 'library';
}

// Server-side Validator (Q-Guard implementation)
function passesProbeGuard(item: ItemInstance, probe: AJJudgment['probe']): boolean {
  if (!probe || probe.intent === "None") return false;
  const t = (probe.text || "").toLowerCase();

  // length & punctuation sanity
  if (t.length === 0 || t.length > 200) return false;
  if (!/[?.!]$/.test(t.trim())) return false;

  // jargon / cueing (The Banned List)
  if (BANNED_TOKENS.some(tok => t.includes(tok))) return false;

  // (optional) avoid over-quoting the stem
  const stem = (item.text || "").toLowerCase();
  const overlap = t.split(/\s+/).filter(w => stem.includes(w)).length;
  if (overlap > 12) return false;

  return true;
}

function fallbackProbe(intent: ProbeIntent): Probe {
  const arr = PROBE_LIBRARY[intent] || [];
  const text = arr[Math.floor(Math.random() * arr.length)] || "";
  return { intent, text, rationale: "library_fallback", confidence: 0.6, source: "library" };
}

// keep a simple session in memory per server instance (fine for demo)
// !! TO BE REPLACED by database persistence in Step 1.4 !!
let SESSION: InMemorySession = {
  theta_mean: 0,
  theta_var: 1.5,
  asked: [],
  coverage: { confounding: 0, temporality: 0, complexity: 0 },
  usedGroups: {}
};

// --- Helper Functions (IRT Math and Data Handling) ---

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1.0 / (1.0 + z);
  } else {
    const z = Math.exp(x);
    return z / (1.0 + z);
  }
}

function itemById(id: string): ItemInstance | undefined {
  return bank.items.find((it) => it.item_id === id);
}

function expectedScore(labels: Record<AJLabel, number> | undefined): number {
  const m = CFG.score_map;
  // Handle TypeScript requirement for explicit typing when iterating over Records
  return Object.entries(labels || {}).reduce((acc, [k, v]) => acc + (m[k as AJLabel] || 0) * (v as number), 0);
}

function labelArgmax(labels: Record<AJLabel, number> | undefined): [AJLabel, number] {
  let best: AJLabel = "Novel";
  let bestp = -1;
  for (const [k, v] of Object.entries(labels || {})) {
    if ((v as number) > bestp) { bestp = v as number; best = k as AJLabel; }
  }
  return [best, bestp];
}

// The core logic implementing the Middle Path strategy
function finalizeLabelAndProbe(item: ItemInstance, aj: AJJudgment, schemaFeatures: SchemaFeatures | undefined) {
  const trace: string[] = [];
  const labels = aj.labels || { Novel: 1.0 } as Record<AJLabel, number>;
  const [finalLabel, pFinal] = labelArgmax(labels);
  const conf = aj.calibrations?.confidence ?? 0.5;
  trace.push(`Argmax label=${finalLabel} (${pFinal.toFixed(2)}); AJ confidence=${conf.toFixed(2)}`);

  // Pitfall and Move checks...
  const pit = aj.pitfalls || {};
  const highPit = Object.entries(pit).filter(([_, v]) => v >= CFG.tau_pitfall_hi).map(([k]) => k);
  if (highPit.length) trace.push(`High pitfalls: ${highPit.join(", ")}`);

  const req = (schemaFeatures?.required_moves) || [];
  const pm = aj.process_moves || {};
  let moveOK = true;
  for (const mv of req) {
    if ((pm[mv] || 0) < CFG.tau_required_move) moveOK = false;
  }
  if (req.length) trace.push(`Required moves present? ${moveOK} (need ≥${CFG.tau_required_move})`);

  // Evidence sufficiency → no probe
  const pComplete = labels["Correct&Complete"] || 0;
  const anyHiPit = highPit.length > 0;
  if (pComplete >= CFG.tau_complete && moveOK && !anyHiPit && conf >= CFG.tau_confidence) {
    trace.push("Evidence sufficient → skip probe.");
    return { finalLabel, probe: { intent: "None", text: "", source: "policy" } as Probe, trace };
  }

  // Guard against AJ failure
  const isFallbackNovel = (labels["Novel"] || 0) >= 0.99 && conf <= 0.25;
  if (isFallbackNovel) {
    trace.push("AJ looked like a fallback/failed call → no probe this turn.");
    return { finalLabel, probe: { intent: "None", text: "", source: "policy" } as Probe, trace };
  }

  // 1) Prefer AJ-authored probe if present & safe (The Middle Path)
  const ajProbe = aj.probe || { intent: "None", text: "" };
  if (ajProbe.intent !== "None") {
    if (passesProbeGuard(item, ajProbe)) {
        trace.push(`Using AJ probe intent=${ajProbe.intent} (guard passed).`);
        return { finalLabel, probe: { ...ajProbe, source: "AJ" } as Probe, trace };
    } else {
        trace.push(`AJ probe intent=${ajProbe.intent} failed guard. Falling back.`);
    }
  }

  // 2) Otherwise, apply a tiny schema-aware default (Fallback)
  if (item.family?.startsWith("C1")) {
    const onlyOne = (pit["only_one_reason_given"] || 0) >= 0.5 || (labels["Partial"] || 0) >= 0.6;
    if (onlyOne) {
      const p = fallbackProbe("Completion");
      trace.push("C1: only one reason given → Completion probe (fallback).");
      return { finalLabel, probe: p, trace };
    }
  }

  if (item.family?.startsWith("C8") && (["Partial", "Incorrect", "Novel"] as AJLabel[]).includes(finalLabel)) {
    const p = fallbackProbe("Boundary");
    trace.push("C8: low-quality → Boundary probe (fallback).");
    return { finalLabel, probe: p, trace };
  }

  // 3) Last resort: minimal label-aware fallback
  let intent: ProbeIntent = "None";
  if (finalLabel === "Correct&Complete") intent = "None";
  else if (finalLabel === "Correct_Missing" || finalLabel === "Correct_Flawed") intent = "Mechanism";
  else if ((["Partial", "Incorrect", "Novel"] as AJLabel[]).includes(finalLabel)) intent = "Alternative";

  const p = fallbackProbe(intent);
  trace.push(`Fallback intent=${intent} (minimal policy).`);
  return { finalLabel, probe: p, trace };
}


// --- Theta Update and Next Item Selection ---

function fusePCorrect(theta: number, item: ItemInstance, aj: AJJudgment) {
    const pBase = sigmoid(item.a * (theta - item.b));
    const pAj = aj.calibrations?.p_correct;
    if (pAj == null) return { p: pBase, note: `p_base=${pBase.toFixed(3)}; no p_correct_AJ` };
    const p = 0.5 * pBase + 0.5 * pAj;
    return { p, note: `p_base=${pBase.toFixed(3)}; p_correct_AJ=${pAj.toFixed(3)}; p_fused=${p.toFixed(3)}` };
}

// WARNING: Modifies global SESSION state
function thetaUpdate(item: ItemInstance, aj: AJJudgment): string[] {
    const labels = aj.labels || {};
    const yhat = expectedScore(labels);
    const { p, note } = fusePCorrect(SESSION.theta_mean, item, aj);
    const info = (item.a ** 2) * p * (1 - p) + 1e-6;
    const thetaVarNew = 1.0 / (1.0 / SESSION.theta_var + info);
    const thetaMeanNew = SESSION.theta_mean + thetaVarNew * item.a * (yhat - p);
    const t = [
        note,
        `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${SESSION.theta_mean.toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${SESSION.theta_var.toFixed(2)}→${thetaVarNew.toFixed(2)}`
    ];
    SESSION.theta_mean = thetaMeanNew;
    SESSION.theta_var = thetaVarNew;
    return t;
}

function eligibleCandidates(): ItemInstance[] {
    const askedSet = new Set(SESSION.asked);
    return bank.items.filter((it) => !askedSet.has(it.item_id));
}

function applyCoverage(cands: ItemInstance[]): ItemInstance[] {
    const need = CFG.coverage_targets.filter((tag) => (SESSION.coverage[tag] || 0) === 0);
    if (need.length === 0) return cands;
    const prior = cands.filter((it) => need.includes(it.coverage_tag));
    return prior.length ? prior : cands;
}

function eigProxy(theta: number, it: ItemInstance): number {
    const p = sigmoid(it.a * (theta - it.b));
    return (it.a ** 2) * p * (1 - p);
}

function selectNextItem() {
    const trace: string[] = [];
    let cands = eligibleCandidates();
    cands = applyCoverage(cands);
    const scored = cands.map((it) => [eigProxy(SESSION.theta_mean, it), it] as [number, ItemInstance]);
    scored.sort((a, b) => b[0] - a[0]);
    if (scored.length === 0) {
        trace.push("No candidates left.");
        return { next: null, trace };
    }
    const [score, best] = scored[0];
    trace.push(`Next=${best.item_id} (EIG≈${score.toFixed(3)}, tag=${best.coverage_tag}, fam=${best.family})`);
    return { next: best, trace };
}

function mergeTwIntoItem(ajItem: AJJudgment, tw: AJJudgment): AJJudgment {
    // Attach-TW policy (simple): if Mechanism present & correct → upgrade completeness.
    if (!tw?.tw_labels) return ajItem;
    const twLab = tw.tw_labels;
    // Check if 'mech_present_correct' exists in the TW labels and meets the threshold
    const mechGood = (twLab.mech_present_correct || 0) >= 0.6;

    if (mechGood) {
        const labels = { ...(ajItem.labels || {}) };
        labels["Correct&Complete"] = Math.max(labels["Correct&Complete"] || 0, 0.9);
        labels["Correct_Missing"] = Math.min(labels["Correct_Missing"] || 0, 0.1);
        const cal = { ...(ajItem.calibrations || {}) };
        cal.p_correct = Math.max(cal.p_correct || 0, 0.85);
        return { ...ajItem, labels, calibrations: cal };
    }
    return ajItem;
}

// Define the expected structure of the request body
interface TurnRequest {
  itemId: string;
  ajMeasurement: AJJudgment;
  twMeasurement?: AJJudgment;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<TurnResult | { error: string, details?: string }>) {
  try {

    // Added a simple session reset mechanism for demo purposes
    if (req.method === 'POST' && req.query.reset === 'true') {
        SESSION = {
            theta_mean: 0,
            theta_var: 1.5,
            asked: [],
            coverage: { confounding: 0, temporality: 0, complexity: 0 },
            usedGroups: {}
        };
        // Return a placeholder response after reset
        return res.status(200).json({
            final_label: "Novel",
            probe_type: "None",
            probe_text: "",
            next_item_id: null,
            theta_mean: 0,
            theta_var: 1.5,
            coverage_counts: {},
            trace: ["Session reset"]
        });
    }


    const { itemId, ajMeasurement, twMeasurement } = req.body as TurnRequest;

    const item = itemById(itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    // Safely access schema features
    const schemaFeat = bank.schema_features[item.schema_id] || {};
    const trace: string[] = [];

    // Merge TW if present (attach policy)
    const ajUsed = twMeasurement ? mergeTwIntoItem(ajMeasurement, twMeasurement) : ajMeasurement;
    if (twMeasurement) trace.push("Merged transcript-window evidence into item measurement.");

    // Policy & probe decision
    const { finalLabel, probe, trace: t1 } = finalizeLabelAndProbe(item, ajUsed, schemaFeat);
    trace.push(...t1);

    // Theta update (Modifies SESSION state)
    // Note: The existing logic updates theta every turn, even if a probe is issued.
    // This is acceptable for the current architecture where the probe evidence is merged back into the original item score.
    const t2 = thetaUpdate(item, ajUsed);
    trace.push(...t2);

    // Update coverage & asked (Modifies SESSION state)
    // Ensure we don't double count if an item somehow gets processed twice (e.g. due to probe merging logic)
    if (!SESSION.asked.includes(item.item_id)) {
        SESSION.asked.push(item.item_id);
        // Ensure the coverage tag is correctly cast and updated
        const tag = item.coverage_tag as CoverageTag;
        // Initialize if the specific tag doesn't exist yet (handles dynamic tags outside the core three)
        if (!(tag in SESSION.coverage)) {
            SESSION.coverage[tag] = 0;
        }
        SESSION.coverage[tag] += 1;
    }

    // Select next item
    const { next, trace: t3 } = selectNextItem();
    trace.push(...t3);


    const responsePayload: TurnResult = {
      final_label: finalLabel,
      probe_type: probe.intent,
      probe_text: probe.text,
      probe_source: probe.source || "unknown",
      next_item_id: next ? next.item_id : null,
      theta_mean: SESSION.theta_mean,
      theta_var: SESSION.theta_var,
      coverage_counts: SESSION.coverage,
      trace
    };

    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "turn error", details: String(err) });
  }
}
