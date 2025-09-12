import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma'; // Import Prisma client
import { Prisma } from '@prisma/client';

// Define the structure expected in the POST request body
interface LogPostRequest {
  session_id: string;
  user_tag?: string;
  type: string;
  item_id?: string;
  ts?: string;
  // The rest of the payload is flexible
  [key: string]: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // --- POST: Create a new log entry ---
    if (req.method === "POST") {
      const entry = req.body as Partial<LogPostRequest> || {};

      // Basic validation
      if (!entry.session_id || !entry.type) {
        // If essential fields are missing, we log a warning and return 202 Accepted.
        // We do not want a logging failure (e.g. due to a transient client issue) to stop the assessment.
        console.warn("Log entry missing essential fields (session_id or type). Ignored.", entry);
        return res.status(202).json({ ok: false, message: "Ignored: Missing session_id or type" });
      }

      // Separate the known fields (which map to DB columns) from the flexible payload
      // Note: user_tag is managed by the Session table, so we exclude it here.
      const { session_id, type, item_id, ts, user_tag, ...payloadData } = entry;

      // Insert the log entry into the database
      await prisma.logEntry.create({
        data: {
          sessionId: session_id,
          type: type,
          itemId: item_id || null,
          // Store the remaining data in the JSONB payload column
          payload: payloadData as Prisma.JsonObject,
          // Use the client timestamp if provided, otherwise default to server time (handled by DB schema)
          timestamp: ts ? new Date(ts) : undefined,
        },
      });

      return res.status(201).json({ ok: true });
    }

    // --- GET: Retrieve SESSIONS (for Admin Dashboard) ---
    if (req.method === "GET") {
      const { limit = '50' } = req.query;
      const take = parseInt(limit as string, 10);

      const sessions = await prisma.session.findMany({
        orderBy: { updatedAt: 'desc' }, // Newest first
        take: take,
// Only fetch sessions that have a transcript with at least one entry.
        where: {
          transcript: {
            path: '$',
            array_not_contains: []
          }
        }
      });

      // Return the sessions; the frontend will format them.
      return res.status(200).json({ sessions });
    }

    // --- DELETE: Clear logs (Admin action) ---
    if (req.method === "DELETE") {
      // !! SECURITY NOTE: This must be protected by admin authentication (Phase 3.1)

      // Clear all logs and sessions for the demo.
      const logCount = await prisma.logEntry.deleteMany({});
      const sessionCount = await prisma.session.deleteMany({});
      return res.status(200).json({ ok: true, message: `Cleared ${logCount.count} logs and ${sessionCount.count} sessions.` });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (e) {
    console.error("Log API error:", e);
    // Handle potential database errors
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // Handle foreign key constraint violations (logging to a non-existent session)
        if (e.code === 'P2003' && req.method === 'POST') {
            // If the session doesn't exist, we shouldn't crash the assessment. Return 202 Accepted.
            console.error(`Log failed due to invalid session_id: ${req.body?.session_id}`);
            return res.status(202).json({ ok: false, message: "Ignored: Invalid session_id (FK constraint)." });
        }
        return res.status(503).json({ error: "Database error", details: e.message });
    }
    return res.status(500).json({ error: "Internal server error", details: (e as Error).message });
  }
}
