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
TASK: Evaluate the user's initial answer and decide if a follow-up probe is needed.

Return JSON with four items:

- 1. score: A single float from 0.0 (completely incorrect) to 1.0 (perfect).
    SCORE GUIDANCE:
    - 1.0: Reflects perfect mastery of the target reasoning skill, and requires no follow-up.
    - 0.7-0.9: Reflects some unclarity or lack of mastery.
    - 0.4-0.6: Contains a mix of correct and incorrect elements.
    - 0.1-0.3: Fundamentally incorrect, but shows some understanding of the question.
    - 0.0: Completely incorrect or off-topic.
    - Base your score entirely on your judgment of the user's reasoning ability applied to this question.
    - Do not base your score on style, grammar, or writing ability: use SUBSTANCE not SUPERFICIAL PRESENTATION. 

- 2. label: Your categorical assessment, chosen from ONE of the following:
    - "Correct": The answer is sufficient and well-reasoned.
    - "Incomplete": The answer is on the right track but misses a key component.
    - "Flawed": The answer contains a correct element but also a clear conceptual error.
    - "Incorrect": The answer is relevant to the question but is conceptually wrong.
    - "Unclear": The answer is too vague or ambiguous to be judged as correct or incorrect.
    - "Off_Topic": The answer is irrelevant, nonsensical, or incoherent.

- 3. probe: An object for your follow-up question.
    - If no probe is needed, return: {"text": ""}
    - If a probe is needed, return an object with: "text": A brief, generic, one-sentence probe.
        PROBE TEXT GUIDANCE:
        - Your probe MUST NOT hint at the correct answer or reveal any flaw.
        - It must be a GENERIC request for the user to reflect on their own answer.
        - For specific cases:
          - If the answer was incomplete or unclear, you can ask for completion or specificity (e.g., "Could you explain why?", "Could you be more specific?").
          - If a list was required, you can ask for the missing item (e.g., "Please add one more reason or explain how your answer gives two reasons").
          - If a phrase was unclear, you can ask for clarification on that phrase (e.g., "Can you explain what you meant by 'X'?").
          - If the answer was flawed, or off-topic, or incorrect & very brief, you can ask in a neutral way for the user to say more (e.g., "Could you elaborate on that?").

- 4. "rationale": A brief, one-sentence explanation for why you are probing (for logs, not shown to user).
`;     


const SECOND_PASS_PROMPT = `
TASK: Evaluate the user's entire exchange, including their initial answer and their follow-up answer to your probe.

Return JSON with only these three fields:

- 1. score: Your FINAL float score from 0.0 to 1.0 for the entire interaction.
        SCORE GUIDANCE FOR FOLLOW-UP:
        - Reward genuine improvement. A user can earn a high final score if their follow-up is excellent and their initial error was minor (e.g., ambiguity or not noticing that two things were asked for and only providing one).
        - Do not reward agreement with hints. If the probe guided the user to the answer, the final score should not be higher than the initial score.
        - Penalize the need for a second try. If the initial answer contained a fundamental flaw in reasoning that they improved in the follow-up, split the difference for the final score. 

- 2. label: Your FINAL categorical assessment, chosen from ONE of the following:
        - "Correct"
        - "Incomplete"
        - "Flawed"
        - "Incorrect"
        - "Ambiguous"
        - "Off_Topic"

- 3. rationale: A brief, one-sentence explanation for your final score. IMPORTANT: Only provide a rationale if the score is less than 1.0.
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
