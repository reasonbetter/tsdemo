// pages/api/aj/init.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { resolveDriver } from "@/engine/registry";
import { loadBank, getSchemaById, getItemById } from "@/lib/bank";
import type { AJInitPayload } from "@/types/kernel";
import { z } from "zod";

// Runtime validation for request body
const ajInitSchema = z.object({
  sessionId: z.string(),
  schemaId: z.string(),
  itemId: z.string().optional(),
  guidanceVersion: z.string(),
  payload: z.object({
    system: z.unknown(),
    context: z.any().nullable(),
  }),
});

/** This endpoint is intentionally lightweight:
 *  - Validates schema & GuidanceVersion exist.
 *  - Optionally store a priming log / cache entry if you like.
 *  - Returns ok=true so the kernel can mark the session primed.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {

    const parsed = ajInitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid request body", details: parsed.error.issues });
    }
    const { sessionId, schemaId, itemId, guidanceVersion, payload } = parsed.data;

    const bank = await loadBank();
    const schema = getSchemaById(bank, schemaId);
    if (schema.GuidanceVersion !== guidanceVersion) {
      return res.status(400).json({ ok: false, error: "GuidanceVersion mismatch" });
    }
    if (itemId) getItemById(bank, itemId); // ensure exists

    // You could persist a record like { sessionId, schemaId, guidanceVersion, at: Date.now() }
    // For now this is a no-op "ack".
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
