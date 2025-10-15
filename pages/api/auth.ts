import type { NextApiRequest, NextApiResponse } from 'next';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cognition';
const SESSION_TOKEN = 'admin_session';

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
      // Set secure HTTP-only cookie
      const cookie = serializeCookie(SESSION_TOKEN, 'authenticated', 60 * 60 * 24); // 24 hours
      res.setHeader('Set-Cookie', cookie);
      return res.status(200).json({ authenticated: true });
    }

    return res.status(401).json({ authenticated: false, error: 'Invalid password' });
  }

  // GET: Check authentication status
  if (req.method === 'GET') {
    const cookies = req.headers.cookie || '';
    const isAuthenticated = cookies.includes(`${SESSION_TOKEN}=authenticated`);
    
    return res.status(200).json({ authenticated: isAuthenticated });
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
  const cookies = req.headers.cookie || '';
  return cookies.includes(`${SESSION_TOKEN}=authenticated`);
}
