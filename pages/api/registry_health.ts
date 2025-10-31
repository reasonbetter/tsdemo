import type { NextApiRequest, NextApiResponse } from "next";
import "@/engine/drivers";
import { registryHealth } from "@/engine/registry";
import { inspectBankHealth } from "@/engine/health/bank_health";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // drivers are registered via top-level import

  const drivers = registryHealth();
  const bank = await inspectBankHealth();

  return res.status(200).json({
    ok: true,
    drivers,
    bank
  });
}
