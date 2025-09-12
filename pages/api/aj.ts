import OpenAI from "openai";
import type { NextApiRequest, NextApiResponse } from 'next';
import { AJJudgment, AJFeatures, ItemInstance, AJLabel } from '@/types/assessment';

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

// Define the expected request body structure
interface AJRequest {
    item: ItemInstance;
    userResponse: string;
    features: AJFeatures;
}

// Base System Prompt (Static Part)
const AJ_SYSTEM_BASE = `You are the Adaptive Judge.

TASK 1 — SCORING:
Return JSON with:
- score: A single floating point number from 0.0 (completely incorrect) to 1.0 (perfect).
- final_label: Your final assessment as one of {"Correct&Complete","Correct_Missing","Correct_Flawed","Partial","Incorrect","Novel"}
- pitfalls: object of probabilities (0–1), use concise keys (e.g., only_one_reason_given, linearity_bias, fixation_on_proximal_cause)
- process_moves: object of probabilities (0–1)
- calibrations: { p_correct: number, confidence: number }

TASK 2 — PROBE RECOMMENDATION:
Also return a "probe" object with:
- intent: one of {"None","Completion","Mechanism","Alternative","Clarify","Boundary"}
- text: a single-sentence probe ≤ 20 words, plain language, no jargon
- rationale: 1 short phrase explaining why this probe (for logs)
- confidence: 0–1

GENERAL POLICIES:
- Do NOT use technical terms (e.g., "confounder","mediator","collider","selection bias","reverse causation").
- Do NOT reveal or cue the target concept or answer.
- Rely heavily on the Item-Specific Guidance provided below for evaluation criteria.
`;

// Function to construct the dynamic prompt
function constructAJPrompt(guidance?: string): string {
    let prompt = AJ_SYSTEM_BASE;

    // Inject the dynamic guidance paragraph if provided
    if (guidance && guidance.trim().length > 0) {
        prompt += `
---
ITEM-SPECIFIC GUIDANCE (Prioritize these instructions):
${guidance}
---
`;
    }

    prompt += "\nOutput strict JSON only.";
    return prompt;
}


export default async function handler(req: NextApiRequest, res: NextApiResponse<AJJudgment | { error: string, details?: string, sample?: string }>) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { item, userResponse, features } = req.body as Partial<AJRequest>;

    if (!item?.text || typeof userResponse !== "string" || !features) {
      return res.status(400).json({ error: "Bad request: missing item.text, userResponse, or features" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Construct the dynamic system prompt using the provided guidance
    const systemPrompt = constructAJPrompt(features.aj_guidance);


    const userMsg = {
      stimulus: item.text,
      user_response: userResponse,
      // We pass the features to the AJ, excluding the guidance which is now in the system prompt
      features: { ...features, aj_guidance: undefined }
    };

    // Use standard Chat Completions API as it reliably supports JSON mode
    let text: string | null | undefined;
    try {
        const r = await client.chat.completions.create({
          model: MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userMsg) }
          ],
          temperature: 1 
        });
        text = r?.choices?.[0]?.message?.content;

    } catch (apiErr: any) {
      return res.status(502).json({
        error: "OpenAI call failed",
        details: apiErr?.message || String(apiErr)
      });
    }

    if (!text || typeof text !== "string") {
      return res.status(502).json({ error: "Empty response from model" });
    }

    let payload: AJJudgment;
    try {
      payload = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Model returned non-JSON",
        sample: text.slice(0, 800)
      });
    }

    // Basic validation
    if (payload.score == null || !payload.final_label || !payload.calibrations || !payload.probe) {
      return res.status(502).json({
        error: "Model returned invalid JSON structure",
        sample: text.slice(0, 800)
      });
    }


    return res.status(200).json(payload);
  } catch (err) {
    console.error("AJ route error:", err);
    return res.status(500).json({ error: "AJ route error", details: String(err) });
  }
}
