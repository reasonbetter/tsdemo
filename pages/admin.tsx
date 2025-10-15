import { useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@prisma/client";
import { HistoryEntry, ThetaState } from "@/types/assessment";
import dynamic from "next/dynamic";
import { CollapsibleSection } from "@/components/CollapsibleSection";

// Dynamically import ReactMarkdown to reduce initial bundle size
const ReactMarkdown = dynamic(() => import("react-markdown"), {
  ssr: false,
  loading: () => <span className="text-muted-foreground">Loading...</span>,
});

type SessionWithTranscript = Omit<Session, "transcript"> & {
  transcript: HistoryEntry[];
};

type DisplayTranscriptEntry = {
  entry: HistoryEntry;
  displayThetaBefore: ThetaState;
  finalThetaState: ThetaState;
};

const DEFAULT_THETA_STATE: ThetaState = { mean: 0, se: Math.sqrt(1.5) };

const sanitizeThetaState = (candidate: unknown, fallback: ThetaState): ThetaState => {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const { mean, se } = candidate as Partial<ThetaState>;
  const safeMean = typeof mean === "number" ? mean : fallback.mean;
  const safeSe = typeof se === "number" ? se : fallback.se;
  return { mean: safeMean, se: safeSe };
};

const isHistoryEntry = (candidate: unknown): candidate is HistoryEntry => {
  return Boolean(
    candidate &&
      typeof candidate === "object" &&
      "text" in candidate &&
      typeof (candidate as { text?: unknown }).text === "string"
  );
};

const parseSessions = (payload: unknown): SessionWithTranscript[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeSessions = (payload as { sessions?: unknown }).sessions;
  if (!Array.isArray(maybeSessions)) {
    return [];
  }

  return maybeSessions.reduce<SessionWithTranscript[]>((acc, session) => {
    if (!session || typeof session !== "object") {
      return acc;
    }

    const { transcript: rawTranscript, ...rest } = session as Session & {
      transcript?: unknown;
    };

    if (!("id" in rest)) {
      return acc;
    }

    const transcript = Array.isArray(rawTranscript)
      ? (rawTranscript as unknown[]).filter(isHistoryEntry)
      : [];

    acc.push({ ...(rest as Omit<Session, "transcript">), transcript });
    return acc;
  }, []);
};

const buildDisplayTranscript = (
  session: SessionWithTranscript
): DisplayTranscriptEntry[] => {
  const sessionFallback = sanitizeThetaState(
    { mean: session.thetaMean, se: Math.sqrt(session.thetaVar) },
    DEFAULT_THETA_STATE
  );

  return session.transcript.reduce<DisplayTranscriptEntry[]>((entries, entry, index, source) => {
    const previousFinalTheta = entries.length
      ? entries[entries.length - 1].finalThetaState
      : DEFAULT_THETA_STATE;

    const displayThetaBefore = sanitizeThetaState(entry.theta_state_before, previousFinalTheta);
    const nextThetaCandidate = index < source.length - 1 ? source[index + 1].theta_state_before : sessionFallback;
    const finalThetaState = sanitizeThetaState(nextThetaCandidate, sessionFallback);

    entries.push({ entry, displayThetaBefore, finalThetaState });
    return entries;
  }, []);
};

// Helper component for displaying Theta change
const ThetaChangeDisplay = ({ before, after }: { before?: ThetaState; after: ThetaState }) => {
  if (!before) return null;

  const change = after.mean - before.mean;
  const color = change > 0.005 ? "text-green-600" : change < -0.005 ? "text-red-600" : "text-gray-500";

  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      θ: {before.mean.toFixed(2)} → {after.mean.toFixed(2)}
    </span>
  );
};

export default function Admin() {
  const [sessions, setSessions] = useState<SessionWithTranscript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      
      if (data.authenticated) {
        setIsAuthenticated(true);
        setPassword('');
      } else {
        alert(data.error || 'Incorrect password');
      }
    } catch (e) {
      alert('Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const refresh = useCallback(async (append = false) => {
    setLoading(true);
    setError(null);

    try {
      const offset = append ? sessions.length : 0;
      const res = await fetch(`/api/log?limit=20&offset=${offset}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const newSessions = parseSessions(data);
      
      setSessions(append ? [...sessions, ...newSessions] : newSessions);
      setHasMore(data.pagination?.hasMore || false);
      setTotalCount(data.pagination?.total || 0);
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.error("Error fetching server logs:", e);
      }
      setError(`Failed to load sessions: ${(e as Error).message}`);
      if (!append) {
        setSessions([]);
      }
    } finally {
      setLoading(false);
    }
  }, [sessions]);

  const downloadJSON = useCallback((data: SessionWithTranscript[], source: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${source}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clearServer = useCallback(async () => {
    const confirmed = confirm(
      "Are you sure you want to delete ALL logs and sessions from the database? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    try {
      const res = await fetch("/api/log", { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to clear database.");
      }

      const result = await res.json();
      alert(result.message || "Database cleared.");
      await refresh();
    } catch (e) {
      alert(`Failed to clear database: ${(e as Error).message}`);
    }
  }, [refresh]);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth');
        const data = await res.json();
        setIsAuthenticated(data.authenticated);
      } catch (e) {
        setIsAuthenticated(false);
      } finally {
        setAuthChecking(false);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    }
  }, [isAuthenticated, refresh]);

  const displaySessions = useMemo(
    () =>
      sessions.map((session) => ({
        session,
        entries: buildDisplayTranscript(session),
      })),
    [sessions]
  );

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Checking authentication...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-lg">
          <h1 className="text-center text-2xl font-bold text-foreground">Admin Access</h1>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-input-border px-4 py-2 text-base transition duration-150 focus:border-primary focus:ring-2 focus:ring-primary"
              placeholder="Password"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full rounded-lg bg-primary px-6 py-2 text-base font-semibold text-white transition duration-150 hover:bg-primary-hover disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-3xl font-bold leading-tight tracking-tight text-foreground">Admin — Session Logs</h1>
      <p className="mb-6 text-muted-foreground">Review full session transcripts stored in the database.</p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-center gap-4">
        <a className="mr-4 text-sm font-medium text-primary transition hover:text-primary-hover" href="/">
          ← Back to Demo
        </a>
        <button
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-primary-hover disabled:opacity-50"
          onClick={() => refresh(false)}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition duration-150 hover:bg-gray-50"
          onClick={() => downloadJSON(sessions, "server-sessions")}
        >
          Download Sessions JSON
        </button>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between px-2 mb-4">
          <h3 className="text-xl font-semibold">
            Session Transcripts
          </h3>
          <span className="text-sm text-muted-foreground">
            Showing {sessions.length} of {totalCount} sessions
          </span>
        </div>
        {sessions.length === 0 && !loading && (
          <p className="text-muted-foreground px-2">No sessions found in the database.</p>
        )}

        {displaySessions.map(({ session, entries }) => {
          const title = `${new Date(session.updatedAt).toLocaleString()}${
            session.userTag ? ` (User: ${session.userTag})` : ""
          }`;

          return (
            <CollapsibleSection
              key={session.id}
              title={title}
              className="bg-card shadow-sm"
              titleSize="xs"
            >
              <div className="space-y-4 text-sm">
                {entries.map(({ entry, displayThetaBefore, finalThetaState }, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-background p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-mono text-xs text-muted-foreground">ITEM: {entry.item_id}</p>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          entry.label === "Correct"
                            ? "bg-green-100 text-green-800"
                            : ["Incomplete", "Flawed", "Ambiguous"].includes(entry.label)
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {entry.label}
                      </span>
                    </div>
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{entry.text}</ReactMarkdown>
                    </div>

                    <div className="mt-2 rounded-md border bg-white p-2">
                      <p>
                        <strong>Answer:</strong> <span className="italic">{entry.answer}</span>
                      </p>
                    </div>

                    {entry.probe_answer ? (
                      <div className="mt-2 rounded-md border border-primary-border bg-primary-light p-2 text-primary-text">
                        <p className="font-semibold">
                          Probe: <span className="italic">{entry.probe_text}</span>
                        </p>
                        {entry.probe_rationale && (
                          <p className="mt-1 text-xs">Rationale: {entry.probe_rationale}</p>
                        )}
                        <p className="mt-2">
                          <strong>Follow-up:</strong> <span className="italic">{entry.probe_answer}</span>
                        </p>
                      </div>
                    ) : null}

                    {entry.final_score !== undefined && (
                      <div className="mt-2 rounded-md border bg-gray-100 p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-800">Final Assessment</p>
                          <ThetaChangeDisplay before={displayThetaBefore} after={finalThetaState} />
                        </div>
                        <p className="text-sm">
                          <strong>Score:</strong> {Number(entry.final_score).toFixed(2)}
                        </p>
                        {entry.final_rationale && (
                          <p className="text-sm italic text-gray-600">Rationale: {entry.final_rationale}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          );
        })}

        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => refresh(true)}
              disabled={loading}
              className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-primary-hover disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load More Sessions'}
            </button>
          </div>
        )}
      </section>

      <div className="mt-12 border-t border-border pt-6">
        <button
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition duration-150 hover:bg-red-100"
          onClick={clearServer}
        >
          Clear Database (All Data)
        </button>
      </div>
    </div>
  );
}
