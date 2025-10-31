import type { NextApiRequest, NextApiResponse } from "next";
import { loadBank } from "@/lib/bank";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const bank = await loadBank();
    // Send a UI-friendly summary
    const items = bank.items.map(i => ({
      ItemID: i.ItemID,
      SchemaID: i.SchemaID,
      Stem: i.Stem,
      MutuallyExclusiveWith: (i as any).MutuallyExclusiveWith ?? undefined,
      MutuallyExclusiveGroup: (i as any).MutuallyExclusiveGroup ?? undefined,
    }));
    res.status(200).json({ ok: true, items });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
