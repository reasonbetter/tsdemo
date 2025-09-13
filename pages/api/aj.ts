import OpenAI from "openai";
import type { NextApiRequest, NextApiResponse } from 'next';
import { AJJudgment, ItemInstance, AJLabel } from '@/types/assessment';

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

// Define the expected request body structures
interface AJRequest {
    item: ItemInstance;
    userResponse: string;
    features: any; // Use 'any' as AJFeatures is no longer a defined type
    full_transcript?: any;
}

// Base System Prompt (Static Part)
const AJ_SYSTEM_BASE = `You are the Adaptive Judge, a fair and insightful evaluator of reasoning.

GENERAL POLICIES:
  - Do NOT use technical terms.
  - Rely heavily on the Item-Specific Guidance provided below.
`;

const FIRST_PASS_PROMPT = `
TASK: Evaluate the interviewee's initial answer and decide if a follow-up probe is needed.

Return JSON with three items:

  - score: A single float from 0.0 (completely incorrect) to 1.0 (perfect).
    SCORING GUIDANCE:
        - 1.0: Perfect, concise, and requires no follow-up.
        - 0.7-0.9: Mostly correct, but could be clearer or more detailed.
        - 0.4-0.6: Contains a mix of correct and incorrect elements.
        - 0.1-0.3: Fundamentally incorrect, but shows some understanding of the question.
        - 0.0: Completely incorrect or off-topic.
        - Base your score entirely on your judgment of the interviewee's reasoning ability applied to this question.
        - Do not base your score on style, grammar, or writing ability: use SUBSTANCE not SUPERFICIAL PRESENTATION. 

- label: Your categorical assessment, chosen from ONE of the following:
        - "Correct": The answer is sufficient and well-reasoned.
        - "Incomplete": The answer is on the right track but misses a key component.
        - "Flawed": The core idea is present, but some aspect of the answer is incorrect.
        - "Incorrect": The answer is relevant but wrong.
        - "Ambiguous": The answer is unclear, vague, or hard to interpret.
        - "Off_Topic": The answer is irrelevant, nonsensical, or incoherent.

- probe: An object for your follow-up question.
        - If no probe is needed, return: {"intent": "None", "text": ""}
        - If a probe is needed, return an object with:
            - "intent": Your reason for probing, chosen from {"Completion", "Improvement", "Alternative", "Clarify", "Boundary"}.
            - "text": A custom, one-sentence probe you write yourself that is contextually relevant to the user's specific answer. IMPORTANT: Do NOT reveal the correct answer or provide direct hints in your probe. A good probe asks the user to reflect on their own answer; it does not contrast their answer with the correct one. DO NOT GIVE HINTS OF ANY KIND! 
            - "rationale": A brief, one-sentence explanation for why you are probing (for logs, not shown to interviewee).
`;+     


const SECOND_PASS_PROMPT = `
TASK: Evaluate the user's entire exchange, including their initial answer and their follow-up answer to your probe.

Return JSON with only these three fields:

    - score: Your FINAL float score from 0.0 to 1.0 for the entire interaction.
        SCORING GUIDANCE FOR FOLLOW-UP:
             - The final score can be much higher than the initial score, but only if the initial answer was simply unclear or ambiguous, without strong evidence of a conceptual flaw, and the probe offered NO HINT OF ANY KIND 
             - If the user required a probe to grasp the relevant concept, apply the relevant process move, or complete their answer, that indicates a flaw in the initial reasoning and significantly reduces their final score. 
             - If the probe gave a hint and the user simply agreed, there should be NO IMPROVEMENT in their initial score. 

    - label: Your FINAL categorical assessment, chosen from ONE of the following:
        - "Correct"
        - "Incomplete"
        - "Flawed"
        - "Incorrect"
        - "Ambiguous"
        - "Off_Topic"

    - rationale: A brief, one-sentence explanation for your final score. IMPORTANT: Only provide a rationale if the score is less than 1.0.
`;

// Function to construct the dynamic prompt
function constructAJPrompt(guidance?: string, isSecondPass: boolean = false): string {
    let prompt = AJ_SYSTEM_BASE;

    prompt += isSecondPass ? SECOND_PASS_PROMPT : FIRST_PASS_PROMPT;

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

    const { item, userResponse, features, full_transcript } = req.body as AJRequest;

    if (!item?.text || typeof userResponse !== "string" || !features) {
      return res.status(400).json({ error: "Bad request: missing item.text, userResponse, or features" });
    }

    const isSecondPass = !!full_transcript;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Construct the dynamic system prompt using the provided guidance
    const systemPrompt = constructAJPrompt(features.aj_guidance, isSecondPass);


    const userMsg = {
      // On the second pass, we send the whole transcript. Otherwise, just the stimulus and response.
      ...(isSecondPass
        ? { transcript: full_transcript }
        : { stimulus: item.text, user_response: userResponse }
      ),
      // Pass the features to the AJ, excluding the guidance which is now in the system prompt
      features: { ...features, aj_guidance: undefined },
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
          temperature: 1,
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
    if (payload.score == null || !payload.label) {
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
