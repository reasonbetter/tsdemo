import { useEffect, useState } from "react";
import { Session } from "@prisma/client";
import { HistoryEntry, ThetaState } from "@/types/assessment";
import ReactMarkdown from 'react-markdown';
import { CollapsibleSection } from "@/components/CollapsibleSection";

// Helper component for displaying Theta change
const ThetaChangeDisplay = ({ before, after }: { before?: ThetaState, after: ThetaState }) => {
    if (!before) return null;
    
    const change = after.mean - before.mean;
    const color = change > 0.005 ? 'text-green-600' : change < -0.005 ? 'text-red-600' : 'text-gray-500';

    return (
        <span className={`font-mono text-sm font-semibold ${color}`}>
            θ: {before.mean.toFixed(2)} → {after.mean.toFixed(2)}
        </span>
    );
};

export default function Admin() {
  const [sessions, setSessions] = useState<Session[]>([]);
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

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/log");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.error("Error fetching server logs:", e);
      setError(`Failed to load sessions: ${(e as Error).message}`);
      setSessions([]);
    }
      setLoading(false);

  }

  function downloadJSON(data: any[], source: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rb-server-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearServer() {
    if (confirm("Are you sure you want to delete ALL logs and sessions from the database? This cannot be undone.")) {
        try {
            const res = await fetch("/api/log", { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to clear database.");
            const result = await res.json();
            alert(result.message || "Database cleared.");
            refresh();
        } catch (e) {
            alert(`Failed to clear database: ${(e as Error).message}`);
        }
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
        refresh();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="w-full max-w-sm p-8 space-y-6 bg-card border border-border rounded-xl shadow-lg">
                <h1 className="text-2xl font-bold text-center text-foreground">Admin Access</h1>
                <form onSubmit={handlePasswordSubmit}>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-2 text-base border border-input-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition duration-150"
                        placeholder="Password"
                    />
                    <button type="submit" className="w-full mt-4 px-6 py-2 text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150">
                        Enter
                    </button>
                </form>
            </div>
        </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground mb-6">Admin — Session Logs</h1>
      <p className="text-muted-foreground mb-6">
        Review full session transcripts stored in the database.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg mb-6" role="alert">
            {error}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-8 items-center">
        <a className="text-primary hover:text-primary-hover font-medium text-sm mr-4" href="/">← Back to Demo</a>
        <button className="px-4 py-2 text-sm font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150" onClick={refresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
        </button>
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={() => downloadJSON(sessions, 'server-sessions')}>Download Sessions JSON</button>
      </div>

      <section className="space-y-2">
            <h3 className="text-xl font-semibold px-2">Session Transcripts (latest {sessions.length})</h3>
            {sessions.length === 0 && !loading && <p className="text-muted-foreground">No sessions found in the database.</p>}

            {sessions.map((session) => {
                let thetaBefore = { mean: 0.0, se: Math.sqrt(1.5) };
                const title = `${new Date(session.updatedAt).toLocaleString()} ${session.userTag ? `(User: ${session.userTag})` : ''}`;
                const transcript = (session.transcript as unknown as HistoryEntry[]) || [];
                
                return (
                    <CollapsibleSection key={session.id} title={title} className="bg-card shadow-sm" titleSize="xs">
                        <div className="space-y-4 text-sm">
                        {transcript.map((entry, idx) => {
                            const finalThetaStateForThisTurn = (idx < transcript.length - 1) 
                                ? transcript[idx+1].theta_state_before || { mean: session.thetaMean, se: Math.sqrt(session.thetaVar) }
                                : { mean: session.thetaMean, se: Math.sqrt(session.thetaVar) };

                            const displayThetaBefore = entry.theta_state_before || thetaBefore;
                            
                            thetaBefore = finalThetaStateForThisTurn;

                            return (
                                <div key={idx} className="p-3 bg-background rounded-lg border border-border">
                                    <div className="flex justify-between items-center mb-2">
                                        <p className="font-mono text-xs text-muted-foreground">ITEM: {entry.item_id}</p>
                                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${entry.label === 'Correct' ? 'bg-green-100 text-green-800' : ['Incomplete', 'Flawed', 'Ambiguous'].includes(entry.label) ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                            {entry.label}
                                        </span>
                                    </div>
                                    <div className="prose prose-sm max-w-none"><ReactMarkdown>{entry.text}</ReactMarkdown></div>
                                    
                                    <div className="mt-2 p-2 bg-white border rounded-md">
                                        <p><strong>Answer:</strong> <span className="italic">{entry.answer}</span></p>
                                    </div>
                                    
                                    {entry.probe_answer ? (
                                        <div className="mt-2 p-2 bg-primary-light border-primary-border text-primary-text rounded-md">
                                            <p className="font-semibold">Probe ({entry.probe_type}): <span className="italic">{entry.probe_text}</span></p>
                                            {entry.probe_rationale && <p className="text-xs mt-1">Rationale: {entry.probe_rationale}</p>}
                                            <p className="mt-2"><strong>Follow-up:</strong> <span className="italic">{entry.probe_answer}</span></p>
                                        </div>
                                    ) : null}

                                    {entry.final_score !== undefined && (
                                        <div className="mt-2 p-2 bg-gray-100 border rounded-md">
                                            <div className="flex justify-between items-center">
                                                <p className="text-xs font-semibold text-gray-800">Final Assessment</p>
                                                <ThetaChangeDisplay before={displayThetaBefore} after={finalThetaStateForThisTurn} />
                                            </div>
                                            <p className="text-sm"><strong>Score:</strong> {Number(entry.final_score).toFixed(2)}</p>
                                            {entry.final_rationale && <p className="text-sm italic text-gray-600">Rationale: {entry.final_rationale}</p>}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                        </div>
                    </CollapsibleSection>
                )
            })}
        </section>
      
      <div className="mt-12 border-t border-border pt-6">
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition duration-150" onClick={clearServer}>
            Clear Database (All Data)
        </button>
      </div>
    </div>
  );
}
