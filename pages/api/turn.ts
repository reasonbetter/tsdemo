// Minimal orchestrator API: policy, theta update, next-item selection
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma'; // Import Prisma client
import { Prisma } from '@prisma/client'; // Import Prisma types for JSON handling

// Import data files
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
  TurnResult,
  CoverageTag,
  AssessmentConfig,
  ProbeLibrary,
  HistoryEntry
} from '@/types/assessment';

// Type assertion for the imported JSON data
const bank: ItemBank = bankData as ItemBank;
const CONFIG: AssessmentConfig = configData as AssessmentConfig;
const PROBE_LIBRARY: ProbeLibrary = probeLibraryData as ProbeLibrary;

const { CFG } = CONFIG;

interface Probe {
  intent: ProbeIntent;
  text: string;
  rationale?: string;
  confidence?: number;
  source: 'policy' | 'AJ' | 'library';
}

// --- Helper Functions (Validation, Fallback, IRT Math) ---

  function fallbackProbe(intent: ProbeIntent): Probe {
    const arr = PROBE_LIBRARY[intent] || [];
    const text = arr[Math.floor(Math.random() * arr.length)] || "";
    return { intent, text, rationale: "library_fallback", confidence: 0.6, source: "policy" };
  }

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

// The core logic implementing the Middle Path strategy
function finalizeLabelAndProbe(item: ItemInstance, aj: AJJudgment, schemaFeatures: SchemaFeatures | undefined) {
    const trace: string[] = [];
    const finalLabel = aj.label;
    trace.push(`Initial label=${finalLabel}`);

    // Map the AI's label to a probe intent
    let probeIntent: ProbeIntent = 'None';
    if (finalLabel === 'Incomplete') probeIntent = 'Completion';
    if (finalLabel === 'Flawed') probeIntent = 'Improvement';
    if (finalLabel === 'Incorrect') probeIntent = 'Alternative';
    if (finalLabel === 'Ambiguous' || finalLabel === 'Off_Topic') probeIntent = 'Clarify';

    // If the score is high enough, we don't probe, regardless of the label.
    if (aj.score >= (CONFIG.CFG.score_correct_threshold || 0.9)) {
        probeIntent = 'None';
        trace.push(`Score ${aj.score} is above threshold, skipping probe.`);
    }

    const probe = fallbackProbe(probeIntent);
    trace.push(`Mapped label '${finalLabel}' to probe intent '${probeIntent}'.`);
    return { finalLabel, probe, trace };
  }


// --- Theta Update and Next Item Selection ---

// Calculates the new theta state based on current state and the new evidence.
function calculateThetaUpdate(currentThetaMean: number, currentThetaVar: number, item: ItemInstance, finalScore: number): { thetaMeanNew: number, thetaVarNew: number, trace: string[] } {
    const yhat = finalScore;
    const p = sigmoid(item.a * (currentThetaMean - item.b));
    const note = `p_base=${p.toFixed(3)}`;
    const info = (item.a ** 2) * p * (1 - p) + 1e-6;
    const thetaVarNew = 1.0 / (1.0 / currentThetaVar + info);
    const thetaMeanNew = currentThetaMean + thetaVarNew * item.a * (yhat - p);
    const trace = [
        note,
        `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${currentThetaMean.toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${currentThetaVar.toFixed(2)}→${thetaVarNew.toFixed(2)}`,
    ];
    return { thetaMeanNew, thetaVarNew, trace };
}

// Helper type for session state needed by selection functions
interface SessionSelectionState {
    askedItemIds: string[];
}

function eligibleCandidates(askedItemIds: string[]): ItemInstance[] {
    const askedSet = new Set(askedItemIds);
    return bank.items.filter((it) => !askedSet.has(it.item_id));
}

function selectNextItem(sessionState: SessionSelectionState): { next: ItemInstance | null; trace: string[] } {
    const trace: string[] = [];
    const { askedItemIds } = sessionState;

    if (askedItemIds.length >= 4) {
        trace.push("Session complete: 4 items have been answered.");
        return { next: null, trace };
    }

    const suiteASchemas = ["P2_M1_S1", "P2_M1_S2", "P2_M1_S3", "P2_M1_S4", "P2_M1_S5", "P2_M1_S6"];

    const askedItems = askedItemIds.map(id => itemById(id)).filter(Boolean) as ItemInstance[];
    const suiteACount = askedItems.filter(item => {
        // Check if the start of the schema_id matches any of the suite A schemas
        return suiteASchemas.some(s => item.schema_id.startsWith(s));
    }).length;
    const suiteBCount = askedItems.length - suiteACount;

    trace.push(`Current counts - Suite A: ${suiteACount}, Suite B: ${suiteBCount}`);

    const candidates = eligibleCandidates(askedItemIds);
    const suiteACandidates = candidates.filter(item => suiteASchemas.some(s => item.schema_id.startsWith(s)));
    const suiteBCandidates = candidates.filter(item => !suiteASchemas.some(s => item.schema_id.startsWith(s)));

    let next: ItemInstance | null = null;

    // Fisher-Yates shuffle to randomize selection
    const shuffle = (array: ItemInstance[]) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    };

    if (suiteACount < 3 && suiteACandidates.length > 0) {
        trace.push(`Selecting from ${suiteACandidates.length} Suite A candidates.`);
        next = shuffle(suiteACandidates)[0];
    } else if (suiteBCount < 1 && suiteBCandidates.length > 0) {
        trace.push(`Selecting from ${suiteBCandidates.length} Suite B candidates.`);
        next = shuffle(suiteBCandidates)[0];
    }

    if (!next) {
        trace.push("No eligible candidates found for the required suites. Ending session.");
        return { next: null, trace };
    }

    const best = next;
    trace.push(`Next (random) =${best.item_id} (schema=${best.schema_id})`);
    return { next: best, trace };
}

// Define the expected structure of the request body
interface TurnRequest {
  sessionId: string;
  itemId: string;
  ajMeasurement: AJJudgment; // This is the first-pass judgment
  twMeasurement?: AJJudgment; // This is the second-pass judgment
  userResponse: string;
  probeResponse?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<TurnResult | { error: string, details?: string }>) {
  try {
    const { sessionId, itemId, ajMeasurement, twMeasurement, userResponse, probeResponse } = req.body as TurnRequest;

    if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required" });
    }

    const item = itemById(itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    const result = await prisma.$transaction(async (tx) => {
        const trace: string[] = [];

        const session = await tx.session.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.status !== 'ACTIVE') {
            throw new Error("Session not found or inactive");
        }
        
        const transcript = (session.transcript && Array.isArray(session.transcript))
            ? (session.transcript as unknown) as HistoryEntry[]
            : [];

        const schemaFeat = bank.schema_features[item.schema_id] || {};

        let finalLabel: AJLabel;
        let probe: Probe;
        let thetaMeanNew = session.thetaMean;
        let thetaVarNew = session.thetaVar;
        let nextItemId: string | null = item.item_id;
        const updatedAskedItemIds = [...session.askedItemIds];

        if (twMeasurement) {
            // SECOND PASS (after a probe)
            trace.push("This is a second pass after a probe answer.");
            const finalAj = twMeasurement;
            finalLabel = finalAj.label;
            probe = { intent: 'None', text: '', source: 'policy' };

            const { thetaMeanNew: tm, thetaVarNew: tv, trace: t2 } = calculateThetaUpdate(session.thetaMean, session.thetaVar, item, finalAj.score);
            thetaMeanNew = tm;
            thetaVarNew = tv;
            trace.push(...t2);

            // Mark item as asked and select the NEXT item
            if (!updatedAskedItemIds.includes(item.item_id)) {
                updatedAskedItemIds.push(item.item_id);
            }
            const { next, trace: t3 } = selectNextItem({ askedItemIds: updatedAskedItemIds });
            nextItemId = next ? next.item_id : null;
            trace.push(...t3);

            // Update Transcript
            const lastEntry = transcript[transcript.length - 1];
            if (lastEntry) {
                lastEntry.probe_answer = probeResponse;
                lastEntry.label = finalLabel;
                lastEntry.final_score = finalAj.score;
                lastEntry.final_rationale = finalAj.rationale;
            }

        } else {
            // FIRST PASS (initial answer)
            trace.push("This is a first pass on an initial answer.");
            const { finalLabel: initialLabel, probe: p, trace: t1 } = finalizeLabelAndProbe(item, ajMeasurement, schemaFeat);
            finalLabel = initialLabel;
            probe = p;
            trace.push(...t1);

            // DO NOT update theta yet.
            if (probe.intent === 'None') {
                // No probe, so this turn is over. Update theta and select next item.
                const { thetaMeanNew: tm, thetaVarNew: tv, trace: t2 } = calculateThetaUpdate(session.thetaMean, session.thetaVar, item, ajMeasurement.score);
                thetaMeanNew = tm;
                thetaVarNew = tv;
                trace.push(...t2);
                
                if (!updatedAskedItemIds.includes(item.item_id)) {
                    updatedAskedItemIds.push(item.item_id);
                }
                const { next, trace: t3 } = selectNextItem({ askedItemIds: updatedAskedItemIds });
                nextItemId = next ? next.item_id : null;
                trace.push(...t3);
            } else {
                nextItemId = item.item_id; // Stay on the same item to await probe response.
            }

            // Add new entry to Transcript
            const newEntry: HistoryEntry = {
                item_id: itemId,
                text: item.text,
                answer: userResponse,
                label: finalLabel,
                probe_type: probe.intent,
                probe_text: probe.text,
                trace: trace,
                final_score: probe.intent === 'None' ? ajMeasurement.score : undefined,
                final_rationale: probe.intent === 'None' ? ajMeasurement.rationale : undefined,
            };
            transcript.push(newEntry);
        }

        await tx.session.update({
            where: { id: sessionId },
            data: {
                thetaMean: thetaMeanNew,
                thetaVar: thetaVarNew,
                askedItemIds: updatedAskedItemIds,
                status: nextItemId ? 'ACTIVE' : 'COMPLETED',
                transcript: transcript as unknown as Prisma.JsonArray,
            },
        });

        const responsePayload: TurnResult = {
            final_label: finalLabel,
            probe_type: probe.intent,
            probe_text: probe.text,
            next_item_id: nextItemId,
            theta_mean: thetaMeanNew,
            theta_var: thetaVarNew,
            coverage_counts: {}, // This is no longer used but required by type
            trace
        };

        return responsePayload;
    });

    return res.status(200).json(result);

  } catch (err) {
    console.error("Turn error:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        return res.status(503).json({ error: "Database transaction error", details: err.message });
    }
     if ((err as Error).message.includes("Session not found or inactive")) {
        return res.status(404).json({ error: (err as Error).message });
    }
    res.status(500).json({ error: "Internal server error", details: (err as Error).message });
  }
}
