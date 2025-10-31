import type { NextApiRequest, NextApiResponse } from "next";
import { loadBank, getSchemaById, getItemById } from "@/lib/bank";
import { z } from "zod";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const querySchema = z.object({
      schemaId: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)),
      itemId: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1)),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid query parameters", details: parsed.error.issues });
    }
    const { schemaId, itemId } = parsed.data;

    const bank = await loadBank();
    const schema = getSchemaById(bank, schemaId) as any;
    const item = getItemById(bank, itemId) as any;

    const schemaGuidance = schema?.DriverConfig?.AJ_System_Guidance ?? schema?.AJ_System_Guidance ?? null;
    const itemGuidance = item?.Content?.ScenarioDefinition ?? null;

    return res.status(200).json({ ok: true, schemaGuidance, itemGuidance });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
