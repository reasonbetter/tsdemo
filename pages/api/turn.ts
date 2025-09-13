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
  // InMemorySession is removed
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

// The global SESSION variable is removed.

interface Probe {
  intent: ProbeIntent;
  text: string;
  rationale?: string;
  confidence?: number;
  source: 'policy' | 'AJ' | 'library';
}

// --- Helper Functions (Validation, Fallback, IRT Math) ---

function passesProbeGuard(item: ItemInstance, probe: AJJudgment['probe']): boolean {
    if (!probe || probe.intent === "None") return false;
    const t = (probe.text || "").toLowerCase();

    // length & punctuation sanity
    if (t.length === 0 || t.length > 200) return false;
    if (!/[?.!]$/.test(t.trim())) return false;

    return true;
  }

  function fallbackProbe(intent: ProbeIntent): Probe {
    const arr = PROBE_LIBRARY[intent] || [];
    const text = arr[Math.floor(Math.random() * arr.length)] || "";
    return { intent, text, rationale: "library_fallback", confidence: 0.6, source: "library" };
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
    const finalLabel = aj.final_label;
    trace.push(`Final label=${finalLabel}`);

    // Pitfall and Move checks...
    const req = (schemaFeatures?.required_moves) || [];
    const tags = aj.tags || [];
    const moveOK = req.every(requiredMove => tags.includes(requiredMove));
    const pitfalls = tags.filter(tag => !req.includes(tag));
    if (pitfalls.length) trace.push(`Pitfalls found: ${pitfalls.join(", ")}`);
    if (req.length) trace.push(`Required moves present? ${moveOK}`);

    // Evidence sufficiency → no probe
    if (finalLabel === "Correct&Complete" && moveOK && pitfalls.length === 0) {
      trace.push("Evidence sufficient → skip probe.");
      return { finalLabel, probe: { intent: "None", text: "", source: "policy" } as Probe, trace };
    }

    // Guard against AJ failure
    const isFallbackNovel = finalLabel === "Novel";
    if (isFallbackNovel) {
      trace.push("AJ looked like a fallback/failed call → no probe this turn.");
      return { finalLabel, probe: { intent: "None", text: "", source: "policy" } as Probe, trace };
    }

    // 1) Prefer AJ-authored probe if present & safe (The Middle Path)
    const ajProbe = aj.probe || { intent: "None", text: "" };
    if (ajProbe.intent !== "None") {
      if (passesProbeGuard(item, ajProbe)) {
          trace.push(`Using AJ probe intent=${ajProbe.intent} (guard passed). Rationale: ${ajProbe.rationale}`);
          return { finalLabel, probe: { ...ajProbe, source: "AJ" } as Probe, trace };
      } else {
          trace.push(`AJ probe intent=${ajProbe.intent} failed guard. Falling back.`);
          // If AJ probe failed guard, use the fallback for that specific intent
          const p = fallbackProbe(ajProbe.intent);
          trace.push(`Using fallback for AJ intent=${ajProbe.intent} (after guard failure).`);
          return { finalLabel, probe: p, trace };
      }
    }

    // 2) Fallback: minimal label-aware fallback (if AJ recommended "None")

    let intent: ProbeIntent = "None";
    if (finalLabel === "Correct_Missing" || finalLabel === "Correct_Flawed") intent = "Mechanism";
    else if ((["Partial", "Incorrect", "Novel"] as AJLabel[]).includes(finalLabel)) intent = "Alternative";

    // Avoid probing if the determined intent is None
    if (intent === "None") {
      trace.push("No suitable probe intent determined (fallback).");
      return { finalLabel, probe: { intent: "None", text: "", source: "policy" } as Probe, trace };
    }

    const p = fallbackProbe(intent);
    trace.push(`Fallback intent=${intent} (minimal policy).`);
    return { finalLabel, probe: p, trace };
  }


// --- Theta Update and Next Item Selection ---

// Calculates the new theta state based on current state and the new evidence.
// This function is pure (does not modify DB or global state).
function calculateThetaUpdate(currentThetaMean: number, currentThetaVar: number, item: ItemInstance, aj: AJJudgment): { thetaMeanNew: number, thetaVarNew: number, trace: string[] } {
    const yhat = aj.score;
    const p = sigmoid(item.a * (currentThetaMean - item.b));
    const note = `p_base=${p.toFixed(3)}`;
    const info = (item.a ** 2) * p * (1 - p) + 1e-6;
    const thetaVarNew = 1.0 / (1.0 / currentThetaVar + info);
    const thetaMeanNew = currentThetaMean + thetaVarNew * item.a * (yhat - p);
    const trace = [
        note,
        `y_hat=${yhat.toFixed(3)}; info=${info.toFixed(3)}; θ: ${currentThetaMean.toFixed(2)}→${thetaMeanNew.toFixed(2)}; var: ${currentThetaVar.toFixed(2)}→${thetaVarNew.toFixed(2)}`
    ];
    return { thetaMeanNew, thetaVarNew, trace };
}

// Helper type for session state needed by selection functions
interface SessionSelectionState {
    thetaMean: number;
    askedItemIds: string[];
    coverageCounts: Record<CoverageTag, number>;
}

function eligibleCandidates(askedItemIds: string[]): ItemInstance[] {
    const askedSet = new Set(askedItemIds);
    return bank.items.filter((it) => !askedSet.has(it.item_id));
}

function applyCoverage(cands: ItemInstance[], coverageCounts: Record<CoverageTag, number>): ItemInstance[] {
    // Ensure coverageCounts is treated as an object even if DB returns null/undefined
    const counts = coverageCounts || {};
    const need = CFG.coverage_targets.filter((tag) => (counts[tag] || 0) === 0);
    if (need.length === 0) return cands;
    const prior = cands.filter((it) => need.includes(bank.schema_features[it.schema_id]?.coverage_tag));
    return prior.length ? prior : cands;
}

function eigProxy(theta: number, it: ItemInstance): number {
    const p = sigmoid(it.a * (theta - it.b));
    return (it.a ** 2) * p * (1 - p);
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

    const best = next; // Use 'best' to match the original return structure.
    trace.push(`Next (random) =${best.item_id} (schema=${best.schema_id})`);
    return { next: best, trace };
}

function mergeTwIntoItem(ajItem: AJJudgment, tw: AJJudgment): AJJudgment {
    // This function is now simpler as it just merges the final score and label
    // For now, we'll just return the original judgment, but this could be enhanced.
    return ajItem;
}

// Define the expected structure of the request body
interface TurnRequest {
  sessionId: string; // Session ID is now required
  itemId: string;
  ajMeasurement: AJJudgment;
  twMeasurement?: AJJudgment;
  userResponse: string;
  probeResponse?: string;
  probeType?: ProbeIntent;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<TurnResult | { error: string, details?: string }>) {
  try {
    // The "reset" mechanism is removed. Sessions are created via /api/create_session.

    const { sessionId, itemId, ajMeasurement, twMeasurement, userResponse, probeResponse, probeType } = req.body as TurnRequest;

    if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required" });
    }

    const item = itemById(itemId);
    if (!item) return res.status(400).json({ error: "Unknown itemId" });

    // --- Database Transaction ---
    // We wrap the entire turn logic in a transaction to ensure atomicity (read-modify-write safety).
    const result = await prisma.$transaction(async (tx) => {
        const trace: string[] = [];

        // 1. Load Session State
        const session = await tx.session.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.status !== 'ACTIVE') {
            throw new Error("Session not found or inactive");
        }

        // Safely parse the coverageCounts and transcript JSONB fields
        const coverageCounts = (session.coverageCounts && typeof session.coverageCounts === 'object' && !Array.isArray(session.coverageCounts))
            ? session.coverageCounts as Record<CoverageTag, number>
            : {} as Record<CoverageTag, number>;
        
        const transcript = (session.transcript && Array.isArray(session.transcript))
            ? (session.transcript as unknown) as HistoryEntry[]
            : [];


        // 2. Process the Turn Logic (Policy, Theta Calculation, Selection)
        const schemaFeat = bank.schema_features[item.schema_id] || {};

        // Merge TW if present
        const ajUsed = twMeasurement ? mergeTwIntoItem(ajMeasurement, twMeasurement) : ajMeasurement;
        if (twMeasurement) trace.push("Merged transcript-window evidence into item measurement.");

        // Policy & probe decision
        const { finalLabel, probe, trace: t1 } = finalizeLabelAndProbe(item, ajUsed, schemaFeat);
        trace.push(...t1);

        // Theta update calculation
        const { thetaMeanNew, thetaVarNew, trace: t2 } = calculateThetaUpdate(session.thetaMean, session.thetaVar, item, ajUsed);
        trace.push(...t2);

        // Update Transcript
        if (twMeasurement) {
            // This is a probe answer, so we update the last transcript entry
            const lastEntry = transcript[transcript.length - 1];
            if (lastEntry) {
                lastEntry.probe_answer = probeResponse;
                lastEntry.probe_label = probeType;
                // The final label might also be updated after a probe
                lastEntry.label = finalLabel;
                // Store the final theta state after the probe
                lastEntry.probe_theta_update = {
                    mean: thetaMeanNew,
                    var: thetaVarNew
                };
            }
        } else {
            // This is a new item answer, so we add a new entry
            const newEntry: HistoryEntry = {
                item_id: itemId,
                text: item.text,
                answer: userResponse,
                label: finalLabel,
                probe_type: probe.intent,
                probe_text: probe.text,
                trace: t1,
                tags: ajUsed.tags,
                theta_mean: thetaMeanNew,
                theta_var: thetaVarNew,
            };
            transcript.push(newEntry);
        }

        // Update coverage & asked lists (in memory)
        const updatedAskedItemIds = [...session.askedItemIds];
        const updatedCoverageCounts = { ...coverageCounts };

        if (!updatedAskedItemIds.includes(item.item_id)) {
            updatedAskedItemIds.push(item.item_id);
            const tag = bank.schema_features[item.schema_id]?.coverage_tag as CoverageTag;
            updatedCoverageCounts[tag] = (updatedCoverageCounts[tag] || 0) + 1;
        }

        // Select next item based on the *new* state
        const { next, trace: t3 } = selectNextItem({
            thetaMean: thetaMeanNew,
            askedItemIds: updatedAskedItemIds,
            coverageCounts: updatedCoverageCounts
        });
        trace.push(...t3);

        // 3. Save Updated Session State (The critical write operation)
        await tx.session.update({
            where: { id: sessionId },
            data: {
                thetaMean: thetaMeanNew,
                thetaVar: thetaVarNew,
                askedItemIds: updatedAskedItemIds,
                coverageCounts: updatedCoverageCounts as Prisma.JsonObject,
                status: next ? 'ACTIVE' : 'COMPLETED',
                transcript: transcript as unknown as Prisma.JsonArray,
            },
        });

        // 4. Construct Response
        const responsePayload: TurnResult = {
            final_label: finalLabel,
            probe_type: probe.intent,
            probe_text: probe.text,
            probe_source: probe.source || "unknown",
            next_item_id: next ? next.item_id : null,
            theta_mean: thetaMeanNew,
            theta_var: thetaVarNew,
            coverage_counts: updatedCoverageCounts,
            trace
        };

        return responsePayload;
    });
    // --- End of Transaction ---

    return res.status(200).json(result);

  } catch (err) {
    console.error("Turn error:", err);
    // Handle potential database errors
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        return res.status(503).json({ error: "Database transaction error", details: err.message });
    }
     // Return a specific error if the session was not found or inactive
     if ((err as Error).message.includes("Session not found or inactive")) {
        return res.status(404).json({ error: (err as Error).message });
    }
    res.status(500).json({ error: "Internal server error", details: (err as Error).message });
  }
}
