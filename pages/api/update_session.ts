import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';

// Define the expected structure of the request body
interface UpdateSessionRequest {
  sessionId: string;
  userTag: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed. Use PATCH.' });
  }

  try {
    const { sessionId, userTag } = req.body as UpdateSessionRequest;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    // Update the userTag for the specific session.
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        // Ensure userTag is stored as null if empty string is provided
        userTag: userTag.trim() === '' ? null : userTag.trim(),
      },
    });

    return res.status(200).json({
        ok: true,
        userTag: session.userTag
    });

  } catch (err) {
    console.error("Update session error:", err);
    // Handle record not found error
    if ((err as any).code === 'P2025') {
        return res.status(404).json({ error: "Session not found" });
    }
    return res.status(500).json({ error: "Failed to update session", details: (err as Error).message });
  }
}
