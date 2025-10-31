import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

// Runtime validation for request body
const updateSessionSchema = z.object({
  sessionId: z.string().min(1),
  userTag: z.string(), // allow empty string; server maps '' -> null
});

interface ErrorResponse {
  error: string;
  code?: string;
  details?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<any | ErrorResponse>) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ 
      ok: false,
      error: 'Method not allowed', 
      code: 'METHOD_NOT_ALLOWED',
      details: 'Only PATCH requests are accepted' 
    });
  }

  try {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues as unknown as string,
      });
    }
    const { sessionId, userTag } = parsed.data;

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
    if (process.env.NODE_ENV !== 'production') {
      console.error("Update session error:", err);
    }
    // Handle record not found error
    if ((err as any).code === 'P2025') {
        return res.status(404).json({ 
          ok: false,
          error: "Session not found", 
          code: "SESSION_NOT_FOUND",
          details: "The specified session does not exist" 
        });
    }
    return res.status(500).json({ 
      ok: false,
      error: "Failed to update session", 
      code: "INTERNAL_ERROR",
      details: (err as Error).message 
    });
  }
}
