import { useCallback, useEffect, useState } from "react";
import { Session } from "@prisma/client";
import { HistoryEntry, ThetaState } from "@/types/assessment";
import ReactMarkdown from "react-markdown";
import { CollapsibleSection } from "@/components/CollapsibleSection";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "cognition") {
      setIsAuthenticated(true);
    } else {
      alert("Incorrect password");
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/log");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setSessions(parseSessions(data));
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) {
      console.error("Error fetching server logs:", e);
      setError(`Failed to load sessions: ${(e as Error).message}`);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadJSON = useCallback((data: unknown[], source: string) => {
  function downloadJSON(data: unknown[], source: string) {
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
  async function clearServer() {
    if (confirm("Are you sure you want to delete ALL logs and sessions from the database? This cannot be undone.")) {
        try {
            const res = await fetch("/api/log", { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to clear database.");
            const result = await res.json();
            alert(result.message || "Database cleared.");
            await refresh();
        } catch (e) {
            alert(`Failed to clear database: ${(e as Error).message}`);
        }
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
              className="w-full rounded-lg border border-input-border px-4 py-2 text-base transition duration-150 focus:border-primary focus:ring-2 focus:ring-primary"
              placeholder="Password"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-6 py-2 text-base font-semibold text-white transition duration-150 hover:bg-primary-hover disabled:opacity-50"
            >
              Enter
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
          onClick={refresh}
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
        <h3 className="px-2 text-xl font-semibold">
          Session Transcripts (latest {sessions.length})
        </h3>
        {sessions.length === 0 && !loading && (
          <p className="text-muted-foreground">No sessions found in the database.</p>
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
