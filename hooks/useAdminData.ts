import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TranscriptEntry } from '@/types/kernel';

export type SessionWithTranscript = {
  id: string;
  thetaMean: number;
  thetaVar: number;
  theta?: unknown;
  userTag?: string | null;
  updatedAt?: string | Date;
  transcript: TranscriptEntry[];
};

function isTranscriptEntry(candidate: unknown): candidate is TranscriptEntry {
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      'text' in (candidate as any) &&
      typeof (candidate as any).text === 'string'
  );
}

function parseSessions(payload: unknown): SessionWithTranscript[] {
  if (!payload || typeof payload !== 'object') return [];
  const maybeSessions = (payload as any).sessions;
  if (!Array.isArray(maybeSessions)) return [];
  return maybeSessions.reduce<SessionWithTranscript[]>((acc, session) => {
    if (!session || typeof session !== 'object') return acc;
    const { transcript: rawTranscript, ...rest } = session as any;
    if (!('id' in rest)) return acc;
    const transcript = Array.isArray(rawTranscript)
      ? (rawTranscript as unknown[]).filter(isTranscriptEntry)
      : [];
    acc.push({ ...(rest as any), transcript });
    return acc;
  }, []);
}

export default function useAdminData() {
  const [sessions, setSessions] = useState<SessionWithTranscript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const handlePasswordSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => null);
      if (data?.authenticated) {
        setIsAuthenticated(true);
        setPassword('');
      } else {
        alert(data?.error || 'Incorrect password');
      }
    } catch {
      alert('Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [password]);

  const refresh = useCallback(async (append = false, currentLength = 0) => {
    setLoading(true);
    setError(null);
    try {
      const offset = append ? currentLength : 0;
      const res = await fetch(`/api/log?limit=20&offset=${offset}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      if (!data || data.ok === false) throw new Error(data?.error || 'Server error');
      const newSessions = parseSessions(data);
      setSessions(prev => (append ? [...prev, ...newSessions] : newSessions));
      setHasMore(Boolean(data.pagination?.hasMore));
      setTotalCount(Number(data.pagination?.total ?? 0));
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.error('Error fetching server logs:', e);
      setError(`Failed to load sessions: ${(e as Error).message}`);
      if (!append) setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadJSON = useCallback((data: SessionWithTranscript[], source: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${source}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearServer = useCallback(async () => {
    const clearPassword = prompt('Enter the secondary admin password to confirm (case-sensitive):');
    if (!clearPassword) { alert('Clear cancelled: no password provided.'); return; }
    try {
      const dryRunRes = await fetch('/api/log?dryRun=true', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: clearPassword, dryRun: true })
      });
      if (dryRunRes.status === 401) { alert('You are not authorized. Please log in again.'); return; }
      if (dryRunRes.status === 403) { alert('Invalid clear password.'); return; }
      if (!dryRunRes.ok) throw new Error('Failed to validate clear request.');
      const dryData = await dryRunRes.json().catch(() => null);
      const logs = dryData?.counts?.logs ?? 0;
      const sessionsToDelete = dryData?.counts?.sessions ?? 0;
      const finalConfirm = confirm(`This will permanently delete ${logs} logs and ${sessionsToDelete} sessions. This cannot be undone.\n\nAre you sure you want to proceed?`);
      if (!finalConfirm) { alert('Clear cancelled.'); return; }
      const res = await fetch('/api/log', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: clearPassword }) });
      if (!res.ok) {
        if (res.status === 401) { alert('You are not authorized. Please log in again.'); return; }
        if (res.status === 403) { alert('Invalid clear password.'); return; }
        throw new Error('Failed to clear database.');
      }
      const result = await res.json().catch(() => null);
      alert(result?.message || 'Database cleared.');
      await refresh(false);
    } catch (e) {
      alert(`Failed to clear database: ${(e as Error).message}`);
    }
  }, [refresh]);

  // Check authentication on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth');
        const data = await res.json().catch(() => null);
        setIsAuthenticated(Boolean(data?.authenticated));
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  useEffect(() => { if (isAuthenticated) refresh(false); }, [isAuthenticated, refresh]);

  return {
    sessions, loading, error, password, setPassword, isAuthenticated, authChecking, hasMore, totalCount,
    handlePasswordSubmit, refresh, downloadJSON, clearServer,
  } as const;
}

