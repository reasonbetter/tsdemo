import type { NextApiRequest, NextApiResponse } from 'next';
// Import the Prisma client utility we configured in Step 1.3
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1. Test Connection: Create a new session
    const newSession = await prisma.session.create({
      data: {
        userTag: 'verification-test',
        askedItemIds: [],
        // coverageCounts and status are defaulted in the schema
      },
    });

    // 2. Test Insertion: Log an event for that session
    await prisma.logEntry.create({
        data: {
            sessionId: newSession.id,
            type: 'DB_VERIFICATION',
            payload: { message: 'Database connection successful' },
        }
    });

    // 3. Test Query: Retrieve the session to confirm
    const retrievedSession = await prisma.session.findUnique({
        where: { id: newSession.id },
        include: { logs: true } // Include the related logs
    });

    return res.status(200).json({
        message: 'Success! Prisma connected to Neon and inserted data.',
        session: retrievedSession
     });

  } catch (error) {
    console.error("Database Test Failed:", error);
    return res.status(500).json({
        message: 'Database connection or insertion failed.',
        error: (error as Error).message,
        // Provide hints for debugging
        db_url_check: process.env.DATABASE_URL ? 'DATABASE_URL is set (check value/permissions/pgbouncer)' : 'DATABASE_URL is NOT set in Vercel environment variables',
        hint: (error as Error).message.includes("relation") ? "Did you successfully run the SQL commands in the Neon editor?" : null
    });
  }
}
