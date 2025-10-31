// pages/api/aj/turn.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { loadBank, getSchemaById, getItemById } from "@/lib/bank";
import { buildAjMessages } from "@/engine/aj/build_prompt";
import { callLLMWithRaw } from "@/engine/aj/llmclient";
import { validateAjOutputOrThrow } from "@/engine/kernel/validation";
import type { SchemaEnvelope } from "@/types/kernel";
import { z } from "zod";
import { createLimiter } from '@/lib/rateLimiter';

const AJ_RL_PER_MIN = Number(process.env.AJ_RL_PER_MIN ?? 8);
const AJ_RL_BURST = Number(process.env.AJ_RL_BURST ?? 3);
const ajLimiter = createLimiter({ perMin: AJ_RL_PER_MIN, burst: AJ_RL_BURST });

// Runtime validation for request body
const ajTurnSchema = z.object({
  sessionId: z.string(),
  schemaId: z.string(),
  itemId: z.string(),
  userText: z.string(),
  context: z
    .union([
      z.object({
        AcceptedThemeTags: z.array(z.string()).optional(),
        DistinctCountSoFar: z.number().optional(),
        TargetDistinctExplanations: z.number().optional(),
        UsedProbeIDs: z.array(z.string()).optional(),
        ScenarioDefinition: z
          .object({ A_text: z.string().optional(), B_text: z.string().optional() })
          .optional(),
      }).partial(),
      z.null(),
    ])
    .optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {

    const parsed = ajTurnSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid request body", details: parsed.error.issues });
    }
    const { sessionId, schemaId, itemId, userText, context } = parsed.data;

    // Rate limit by sessionId/IP
    const key = sessionId || (Array.isArray(req.headers['x-forwarded-for']) ? req.headers['x-forwarded-for'][0] : (req.headers['x-forwarded-for'] as string)) || (req.socket?.remoteAddress || 'anon');
    const rl = ajLimiter.check(String(key));
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.resetSec));
      res.setHeader('X-RateLimit-Limit', String(AJ_RL_PER_MIN));
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
      return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
    }

    const bank = await loadBank();
    const schema = getSchemaById(bank, schemaId) as SchemaEnvelope;
    const item = getItemById(bank, itemId);

    const messages = buildAjMessages(schema, item, {
      userText,
      AcceptedThemeTags: context?.AcceptedThemeTags,
      DistinctCountSoFar: context?.DistinctCountSoFar,
      TargetDistinctExplanations: context?.TargetDistinctExplanations,
      UsedProbeIDs: context?.UsedProbeIDs,
      ScenarioDefinition: context?.ScenarioDefinition ?? (item as any)?.Content?.ScenarioDefinition
    });

    // Attempt 1
    const r1 = await callLLMWithRaw(messages, { model: "gpt-5-mini", extractJson: true });
    if (r1.parsed == null) {
      const showDebug = (process.env.DEBUG_API_RESPONSES === 'true') || (!process.env.DEBUG_API_RESPONSES && process.env.NODE_ENV !== 'production');
      const payload: any = { ok: false, error: "Model did not return valid JSON" };
      if (showDebug) payload.debug = { messages, raw: r1.raw, diagnostic: r1.diagnostic };
      return res.status(500).json(payload);
    }
    try {
      validateAjOutputOrThrow(schema, r1.parsed);
      const showDebug = (process.env.DEBUG_API_RESPONSES === 'true') || (!process.env.DEBUG_API_RESPONSES && process.env.NODE_ENV !== 'production');
      const payload: any = { ok: true, measurement: r1.parsed };
      if (showDebug) payload.debug = { messages, raw: r1.raw, diagnostic: r1.diagnostic };
      return res.status(200).json(payload);
    } catch (e1: any) {
      // Attempt 2: reinforce strict JSON instruction
      const retryMessages = [
        ...messages,
        { role: "user", content: "Reminder: Return strict JSON ONLY that conforms to the schema. No markdown, no code fences, no explanations. If the schema permits a number, return a bare number." }
      ] as const;
      const r2 = await callLLMWithRaw(retryMessages as any, { model: "gpt-5-mini", extractJson: true });
      if (r2.parsed == null) {
        const showDebug = (process.env.DEBUG_API_RESPONSES === 'true') || (!process.env.DEBUG_API_RESPONSES && process.env.NODE_ENV !== 'production');
        const payload: any = { ok: false, error: "Model did not return valid JSON" };
        if (showDebug) payload.debug = { messages: retryMessages, raw: r2.raw, diagnostic: r2.diagnostic };
        return res.status(500).json(payload);
      }
      try {
        validateAjOutputOrThrow(schema, r2.parsed);
        const showDebug = (process.env.DEBUG_API_RESPONSES === 'true') || (!process.env.DEBUG_API_RESPONSES && process.env.NODE_ENV !== 'production');
        const payload: any = { ok: true, measurement: r2.parsed };
        if (showDebug) payload.debug = { messages: retryMessages, raw: r2.raw, diagnostic: r2.diagnostic };
        return res.status(200).json(payload);
      } catch (e2: any) {
        const showDebug = (process.env.DEBUG_API_RESPONSES === 'true') || (!process.env.DEBUG_API_RESPONSES && process.env.NODE_ENV !== 'production');
        const payload: any = { ok: false, error: `AJ validation error: ${String(e2?.message || e2)}` };
        if (showDebug) payload.debug = { messages: retryMessages, raw: r2.raw, diagnostic: r2.diagnostic };
        return res.status(500).json(payload);
      }
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
