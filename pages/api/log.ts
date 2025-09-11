import type { NextApiRequest, NextApiResponse } from 'next';
import { LogEntry } from '@/types/assessment';

let LOGS: LogEntry[] = []; // ephemeral on serverless; fine for demo
// !! TO BE REPLACED by database persistence in Step 1.5 !!

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "POST") {
      const entry = req.body as Partial<LogEntry> || {};
      const withTs: LogEntry = {
        // Provide defaults for required fields if missing
        session_id: entry.session_id || null,
        user_tag: entry.user_tag || null,
        type: entry.type || 'unknown',
        ...entry,
        ts: entry.ts || new Date().toISOString()
      };
      LOGS.push(withTs);
      if (LOGS.length > 1000) LOGS = LOGS.slice(-1000);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "GET") {
      return res.status(200).json({ logs: LOGS });
    }
    if (req.method === "DELETE") {
      LOGS = [];
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "log error", details: String(e) });
  }
}
