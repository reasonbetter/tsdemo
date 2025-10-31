import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma'; // Import Prisma client
import { Prisma } from '@prisma/client';
import { isAuthenticated } from './auth';
import { z } from 'zod';

// Secondary password for destructive admin actions
const ADMIN_CLEAR_PASSWORD = process.env.ADMIN_CLEAR_PASSWORD || 'Achtung';

// Define the structure expected in the POST request body
const logPostSchema = z
  .object({
    session_id: z.string().min(1),
    type: z.string().min(1),
    item_id: z.string().optional(),
    ts: z.string().optional(),
  })
  .passthrough(); // allow flexible additional payload fields

const logGetQuerySchema = z.object({
  limit: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.coerce.number().int().nonnegative().optional()),
  offset: z
    .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.coerce.number().int().nonnegative().optional()),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // --- POST: Create a new log entry ---
    if (req.method === "POST") {
      const parsed = logPostSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          ok: false,
          error: "Invalid request body", 
          code: "VALIDATION_ERROR",
          details: parsed.error.issues 
        });
      }
      const entry = parsed.data as any;

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

      // Ensure Session row exists to satisfy FK; create minimal if missing
      await prisma.session.upsert({
        where: { id: session_id },
        update: user_tag ? { userTag: user_tag } : {},
        create: {
          id: session_id,
          userTag: user_tag ?? null,
          askedItemIds: [],
          // other columns have defaults in Prisma schema
        },
      });

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
      const q = logGetQuerySchema.safeParse(req.query);
      if (!q.success) {
        return res.status(400).json({ ok: false, error: "Invalid query parameters", code: "VALIDATION_ERROR", details: q.error.issues });
      }
      const takeRaw = q.data.limit ?? 20;
      const offsetRaw = q.data.offset ?? 0;
      const take = Math.min(takeRaw, 100);
      const skip = offsetRaw;

      const [sessions, totalCount] = await Promise.all([
        prisma.session.findMany({
          orderBy: { updatedAt: "desc" },
          take,
          skip,
          // Show sessions regardless of transcript contents
        }),
        prisma.session.count({}),
      ]);

      // Return the sessions with pagination metadata
      return res.status(200).json({ 
        ok: true,
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
        return res.status(401).json({ ok: false, error: "Unauthorized", code: "AUTH_REQUIRED" });
      }

      // Validate secondary clear password from header, body, or query
      const providedClearPwd =
        (req.headers['x-clear-password'] as string | undefined) ||
        (typeof req.body === 'object' && req.body ? (req.body as any).password : undefined) ||
        (typeof req.query.password === 'string' ? req.query.password : undefined);

      if (providedClearPwd !== ADMIN_CLEAR_PASSWORD) {
        return res.status(403).json({ ok: false, error: "Forbidden: invalid clear password", code: "INVALID_CLEAR_PASSWORD" });
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

    return res.status(405).json({ ok: false, error: "Method not allowed" });

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
          ok: false,
          error: "Session not found", 
          code: "SESSION_NOT_FOUND",
          details: "The specified session_id does not exist" 
        });
      }
      return res.status(503).json({ 
        ok: false,
        error: "Database error", 
        code: "DB_ERROR",
        details: e.message 
      });
    }
    return res.status(500).json({ 
      ok: false,
      error: "Internal server error", 
      code: "INTERNAL_ERROR",
      details: (e as Error).message 
    });
  }
}
