// Kernel-forwarding controller: forwards user turn + AJ measurement to kernel
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSessionStore } from '@/engine/session/store';
import { applyTurnKernel } from '@/engine/kernel/applyTurnKernel';
// Force-load driver registrations at module load (extra safety for HMR)
import "@/engine/drivers";

import { z } from 'zod';
import type { TurnRequestBody } from '@/types/kernel';
import { createLimiter } from '@/lib/rateLimiter';

// Zod schema for runtime validation of the request body
const turnRequestSchema = z.object({
  sessionId: z.string(),
  schemaId: z.string(),
  itemId: z.string(),
  userResponse: z.string().optional(),
  probeResponse: z.string().optional(),
  ajMeasurement: z.unknown().optional(),
  twMeasurement: z.unknown().optional(), // Legacy
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const validation = turnRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ ok: false, error: "Invalid request body", details: validation.error.issues });
    }
    const { sessionId, schemaId, itemId, userResponse, probeResponse, ajMeasurement, twMeasurement } = validation.data;

    // Rate limit by sessionId, falling back to remote IP
    const key = sessionId || (Array.isArray(req.headers['x-forwarded-for']) ? req.headers['x-forwarded-for'][0] : (req.headers['x-forwarded-for'] as string)) || (req.socket?.remoteAddress || 'anon');
    const rl = turnLimiter.check(String(key));
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.resetSec));
      res.setHeader('X-RateLimit-Limit', String(TURN_RL_PER_MIN));
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
      return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
    }

    const store = getSessionStore();

    const userText: string = probeResponse ?? userResponse ?? "";
    const ajRaw = ajMeasurement ?? twMeasurement ?? null;

    const requireExisting = process.env.TURN_REQUIRE_EXISTING_SESSION === 'true';
    let session = sessionId ? await store.get(sessionId) : null;
    if (!session) {
      if (requireExisting) {
        return res.status(400).json({ ok: false, error: "Invalid or missing sessionId" });
      }
      session = await store.create(sessionId);
    }

    const kernelResult = await applyTurnKernel({
      session,
      schemaId,
      itemId,
      userText,
      ajRaw,
      sessionPersist: async (s) => { await store.put(s); }
    });

    return res.status(200).json({
      ok: true,
      probe: kernelResult.probe ?? null,
      completed: kernelResult.completed,
      theta: kernelResult.theta,
      unitState: kernelResult.unitState,
      telemetry: kernelResult.telemetry,
      transcript: kernelResult.transcript,
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
// Simple in-memory rate limiter per sessionId/IP
const TURN_RL_PER_MIN = Number(process.env.TURN_RL_PER_MIN ?? 12);
const TURN_RL_BURST = Number(process.env.TURN_RL_BURST ?? 5);
const turnLimiter = createLimiter({ perMin: TURN_RL_PER_MIN, burst: TURN_RL_BURST });
