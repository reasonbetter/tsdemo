import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cognition';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'change-this-secret';
const SESSION_TOKEN = 'admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

interface SessionPayload {
  issuedAt: number;
  expiresAt: number;
}

function signPayload(payload: SessionPayload): string {
  const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(base)
    .digest('base64url');
  return `${base}.${signature}`;
}

function parseSessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [base, signature] = token.split('.');
  if (!base || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(base)
    .digest('base64url');

  let providedBuffer: Buffer;
  let expectedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(signature, 'base64url');
    expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  } catch {
    return null;
  }

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8')) as SessionPayload;
    if (
      typeof payload?.issuedAt !== 'number' ||
      typeof payload?.expiresAt !== 'number' ||
      Number.isNaN(payload.issuedAt) ||
      Number.isNaN(payload.expiresAt)
    ) {
      return null;
    }

    if (payload.expiresAt < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getCookie(req: NextApiRequest, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map((part) => part.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) {
      return cookie.slice(name.length + 1);
    }
  }
  return null;
}

interface AuthRequest {
  password: string;
}

interface AuthResponse {
  authenticated: boolean;
  error?: string;
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/${secure}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AuthResponse>
) {
  // POST: Login
  if (req.method === 'POST') {
    const { password } = req.body as AuthRequest;

    if (!password) {
      return res.status(400).json({ authenticated: false, error: 'Password required' });
    }

    if (password === ADMIN_PASSWORD) {
      const now = Date.now();
      const payload: SessionPayload = {
        issuedAt: now,
        expiresAt: now + SESSION_MAX_AGE * 1000,
      };

      const token = signPayload(payload);
      const cookie = serializeCookie(SESSION_TOKEN, token, SESSION_MAX_AGE);
      res.setHeader('Set-Cookie', cookie);
      return res.status(200).json({ authenticated: true });
    }

    return res.status(401).json({ authenticated: false, error: 'Invalid password' });
  }

  // GET: Check authentication status
  if (req.method === 'GET') {
    const token = getCookie(req, SESSION_TOKEN);
    const payload = parseSessionToken(token);
    return res.status(200).json({ authenticated: !!payload });
  }

  // DELETE: Logout
  if (req.method === 'DELETE') {
    const cookie = serializeCookie(SESSION_TOKEN, '', 0); // Expire immediately
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ authenticated: false });
  }

  return res.status(405).json({ authenticated: false, error: 'Method not allowed' });
}

// Helper function to check authentication (can be imported by other API routes)
export function isAuthenticated(req: NextApiRequest): boolean {
  const token = getCookie(req, SESSION_TOKEN);
  return parseSessionToken(token) !== null;
}
