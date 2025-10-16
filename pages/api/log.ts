import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma'; // Import Prisma client
import { Prisma } from '@prisma/client';
import { isAuthenticated } from './auth';

// Secondary password for destructive admin actions
const ADMIN_CLEAR_PASSWORD = process.env.ADMIN_CLEAR_PASSWORD || 'Achtung';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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
        return res.status(400).json({ 
          error: "Missing required fields", 
          code: "VALIDATION_ERROR",
          details: "Both session_id and type are required" 
        });
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
      if (!isAuthenticated(req)) {
        return res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
      }

      const { limit = '20', offset = '0' } = req.query;

      const rawLimit = Array.isArray(limit) ? limit[0] : limit;
      const rawOffset = Array.isArray(offset) ? offset[0] : offset;

      const parsedLimit = parseInt(rawLimit ?? '', 10);
      const parsedOffset = parseInt(rawOffset ?? '', 10);

      const take = !Number.isNaN(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

      const skip = !Number.isNaN(parsedOffset) && parsedOffset >= 0
        ? parsedOffset
        : 0;

      const [sessions, totalCount] = await Promise.all([
        prisma.session.findMany({
          orderBy: { updatedAt: "desc" },
          take,
          skip,
          // Only fetch sessions that have a transcript with at least one entry.
          where: {
            NOT: {
              transcript: {
                equals: [],
              },
            },
          },
        }),
        prisma.session.count({
          where: {
            NOT: {
              transcript: {
                equals: [],
              },
            },
          },
        }),
      ]);

      // Return the sessions with pagination metadata
      return res.status(200).json({ 
        sessions, 
        pagination: {
          total: totalCount,
          limit: take,
          offset: skip,
          hasMore: skip + take < totalCount
        }
      });
    }

    // --- DELETE: Clear logs (Admin action) ---
    if (req.method === "DELETE") {
      // Check authentication (must be logged in via admin cookie)
      if (!isAuthenticated(req)) {
        return res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
      }

      // Validate secondary clear password from header, body, or query
      const providedClearPwd =
        (req.headers['x-clear-password'] as string | undefined) ||
        (typeof req.body === 'object' && req.body ? (req.body as any).password : undefined) ||
        (typeof req.query.password === 'string' ? req.query.password : undefined);

      if (providedClearPwd !== ADMIN_CLEAR_PASSWORD) {
        return res.status(403).json({ error: "Forbidden: invalid clear password", code: "INVALID_CLEAR_PASSWORD" });
      }

      // Support dry-run to safely validate and preview counts
      const dryRunFlagFromBody = typeof req.body === 'object' && req.body ? (req.body as any).dryRun : undefined;
      const dryRunFlagFromQuery = typeof req.query.dryRun === 'string' ? req.query.dryRun : undefined;
      const isDryRun = dryRunFlagFromBody === true || dryRunFlagFromBody === 'true' || dryRunFlagFromQuery === 'true' || dryRunFlagFromQuery === '1';

      // Compute counts (used for both dry-run preview and response after deletion)
      const [logCountPreview, sessionCountPreview] = await Promise.all([
        prisma.logEntry.count(),
        prisma.session.count(),
      ]);

      if (isDryRun) {
        return res.status(200).json({ ok: true, dryRun: true, message: `Dry run: would clear ${logCountPreview} logs and ${sessionCountPreview} sessions.` , counts: { logs: logCountPreview, sessions: sessionCountPreview }});
      }

      // Clear all logs and sessions for the demo.
      const logCount = await prisma.logEntry.deleteMany({});
      const sessionCount = await prisma.session.deleteMany({});
      return res.status(200).json({ ok: true, message: `Cleared ${logCount.count} logs and ${sessionCount.count} sessions.`, counts: { logs: logCount.count, sessions: sessionCount.count } });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (e) {
    console.error("Log API error:", e);
    // Handle potential database errors
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle foreign key constraint violations (logging to a non-existent session)
      if (e.code === "P2003" && req.method === "POST") {
        if (process.env.NODE_ENV !== 'production') {
          console.error(`Log failed due to invalid session_id: ${req.body?.session_id}`);
        }
        return res.status(404).json({ 
          error: "Session not found", 
          code: "SESSION_NOT_FOUND",
          details: "The specified session_id does not exist" 
        });
      }
      return res.status(503).json({ 
        error: "Database error", 
        code: "DB_ERROR",
        details: e.message 
      });
    }
    return res.status(500).json({ 
      error: "Internal server error", 
      code: "INTERNAL_ERROR",
      details: (e as Error).message 
    });
  }
}
