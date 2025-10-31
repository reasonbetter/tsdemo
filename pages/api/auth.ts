import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { z } from 'zod';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cognition';
const SESSION_COOKIE = 'admin_session';
const ONE_DAY_SECONDS = 60 * 60 * 24;

const isProd = process.env.NODE_ENV === 'production';
const ALLOW_WEAK_ADMIN_PASSWORD = process.env.ALLOW_WEAK_ADMIN_PASSWORD === 'true';
// In production, require a strong admin password unless explicitly allowed for beta/testing
if (isProd && ADMIN_PASSWORD === 'cognition' && !ALLOW_WEAK_ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD must be set to a strong value in production. To override temporarily, set ALLOW_WEAK_ADMIN_PASSWORD=true.');
}
if (isProd && ADMIN_PASSWORD === 'cognition' && ALLOW_WEAK_ADMIN_PASSWORD) {
  // Log a warning once in production if weak password is allowed
  // eslint-disable-next-line no-console
  console.warn('[WARN] Running with weak ADMIN_PASSWORD in production (beta mode enabled). Set a stronger password ASAP.');
}

// Derive the session signing key from the admin password (avoids extra env var)
function getSessionSecret(): string {
  return crypto.createHash('sha256').update(String(ADMIN_PASSWORD)).digest('hex');
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(data: string, secret: string): string {
  return base64url(crypto.createHmac('sha256', secret).update(data).digest());
}

function createSessionToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + ONE_DAY_SECONDS,
    jti: base64url(crypto.randomBytes(16)),
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = sign(payloadB64, getSessionSecret());
  return `${payloadB64}.${signature}`;
}

function verifySessionToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadB64, signature] = token.split('.', 2);
  const expected = sign(payloadB64, getSessionSecret());
  if (!timingSafeEqualStr(signature, expected)) return false;
  try {
    const payloadJson = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as { exp?: number; sub?: string };
    if (payload.sub !== 'admin') return false;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const secure = isProd ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/${secure}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const [rawName, ...rest] = part.trim().split('=');
    if (!rawName) continue;
    const value = rest.join('=');
    try {
      cookies[rawName] = decodeURIComponent(value);
    } catch {
      cookies[rawName] = value;
    }
  }
  return cookies;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ authenticated: boolean; error?: string }>
) {
  // POST: Login
  if (req.method === 'POST') {
    const bodySchema = z.object({ password: z.string().min(1) });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ authenticated: false, error: 'Password required', ok: false } as any);
    }
    const { password } = parsed.data;

    if (password === ADMIN_PASSWORD) {
      // Set signed session token cookie
      const token = createSessionToken();
      const cookie = serializeCookie(SESSION_COOKIE, token, ONE_DAY_SECONDS);
      res.setHeader('Set-Cookie', cookie);
      return res.status(200).json({ authenticated: true, ok: true } as any);
    }

    return res.status(401).json({ authenticated: false, error: 'Invalid password', ok: false } as any);
  }

  // GET: Check authentication status
  if (req.method === 'GET') {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE] || null;
    const ok = verifySessionToken(token);
    return res.status(200).json({ authenticated: ok, ok: true } as any);
  }

  // DELETE: Logout
  if (req.method === 'DELETE') {
    const cookie = serializeCookie(SESSION_COOKIE, '', 0); // Expire immediately
    res.setHeader('Set-Cookie', cookie);
    return res.status(200).json({ authenticated: false, ok: true } as any);
  }

  return res.status(405).json({ authenticated: false, error: 'Method not allowed', ok: false } as any);
}

// Helper function to check authentication (can be imported by other API routes)
export function isAuthenticated(req: NextApiRequest): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE] || null;
  return verifySessionToken(token);
}
