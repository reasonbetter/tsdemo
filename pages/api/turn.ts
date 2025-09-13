// Minimal orchestrator API: policy, theta update, next-item selection
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma'; // Import Prisma client
import { Prisma } from '@prisma/client'; // Import Prisma types for JSON handling

// Import data files
import bankData from "@/data/itemBank.json";
import configData from "@/data/config.json";

import {
  ItemBank,
  ItemInstance,
  AJJudgment,
  AJLabel,
  SchemaFeatures,
  TurnResult,
  CoverageTag,
  AssessmentConfig,
  HistoryEntry
} from '@/types/assessment';

// Type assertion for the imported JSON data
const bank: ItemBank = bankData as ItemBank;
const CONFIG: AssessmentConfig = configData as AssessmentConfig;

const { CFG } = CONFIG;

// --- Helper Functions ---

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


// --- Theta Update and Next Item Selection ---

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

    if (askedItemIds.length >= 5) {
        trace.push("Session complete: 5 items have been answered.");
        return { next: null, trace };
    }

    const candidates = eligibleCandidates(askedItemIds);

    const shuffle = (array: ItemInstance[]) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    };

    if (candidates.length === 0) {
        trace.push("No eligible candidates found. Ending session.");
        return { next: null, trace };
    }
    const best = shuffle(candidates)[0];
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
        let probeText = "";
        let thetaMeanNew = session.thetaMean;
        let thetaVarNew = session.thetaVar;
        let nextItemId: string | null = item.item_id;
        const updatedAskedItemIds = [...session.askedItemIds];

        if (twMeasurement) {
            // SECOND PASS (after a probe)
            trace.push("This is a second pass after a probe answer.");
            const finalAj = twMeasurement;
            const thetaStateBefore = { mean: session.thetaMean, se: Math.sqrt(session.thetaVar) };
            finalLabel = finalAj.label;

            const { thetaMeanNew: tm, thetaVarNew: tv, trace: t2 } = calculateThetaUpdate(session.thetaMean, session.thetaVar, item, finalAj.score);
            thetaMeanNew = tm;
            thetaVarNew = tv;
            trace.push(...t2);

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
                lastEntry.theta_state_before = thetaStateBefore;
                lastEntry.final_score = finalAj.score;
                lastEntry.final_rationale = finalAj.rationale || "";
            }

        } else {
            // FIRST PASS (initial answer)
            trace.push("This is a first pass on an initial answer.");
            finalLabel = ajMeasurement.label;
            
            // Determine if we should probe
            const shouldProbe = ajMeasurement.score < (CONFIG.CFG.score_correct_threshold || 0.9) && ajMeasurement.label !== 'Incorrect' && ajMeasurement.probe && ajMeasurement.probe.text.trim().length > 0;
            
            if (shouldProbe) {
                probeText = ajMeasurement.probe!.text;
                trace.push(`AI recommended a probe: ${probeText}`);
                nextItemId = item.item_id; // Stay on the same item
            } else {
                // No probe, so this turn is over. Update theta and select next item.
                trace.push("No probe needed. Finalizing turn.");
                const thetaStateBefore = { mean: session.thetaMean, se: Math.sqrt(session.thetaVar) };
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
            }

            // Add new entry to Transcript
            const newEntry: HistoryEntry = {
                item_id: itemId,
                text: item.text,
                answer: userResponse,
                label: finalLabel,
                probe_text: probeText,
                trace: trace,
                probe_rationale: ajMeasurement.probe?.rationale,
                initial_score: ajMeasurement.score,
                initial_tags: (ajMeasurement as any).tags,
                final_score: !shouldProbe ? ajMeasurement.score : undefined,
                final_rationale: !shouldProbe ? ajMeasurement.rationale : undefined,
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
            probe_text: probeText,
            next_item_id: nextItemId,
            theta_mean: thetaMeanNew,
            theta_var: thetaVarNew,
            coverage_counts: {},
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
