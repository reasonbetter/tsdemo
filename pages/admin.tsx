import { useEffect, useState } from "react";
import { Session } from "@prisma/client";
import { LogEntry as ClientLogEntry, HistoryEntry } from "@/types/assessment";
import ReactMarkdown from 'react-markdown';
import { CollapsibleSection } from "@/components/CollapsibleSection";

// Helper component to display the new metadata
const MetadataDisplay = ({ data }: { data: Record<string, number | undefined | null> }) => {
    const entries = Object.entries(data).filter(([, value]) => value != null && value > 0.1);
    if (entries.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {entries.map(([key, value]) => (
                <span key={key} className="text-xs text-muted-foreground font-mono">
                    {key}: {Number(value).toFixed(2)}
                </span>
            ))}
        </div>
    );
};


export default function Admin() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [localLogs, setLocalLogs] = useState<ClientLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    try {
      const arr = JSON.parse(localStorage.getItem("rb_local_logs") || "[]") as ClientLogEntry[];
      arr.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setLocalLogs(arr);
    } catch {
      setLocalLogs([]);
    }
    setLoading(false);
  }

  function downloadJSON(data: any[], source: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rb-${source}-logs-${Date.now()}.json`;
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

  function clearLocal() {
    localStorage.removeItem("rb_local_logs");
    refresh();
  }

  useEffect(() => { refresh(); }, []);

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
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition duration-150" onClick={clearServer}>Clear Database (All Data)</button>
      </div>

      <section className="space-y-4">
            <h3 className="text-xl font-semibold">Session Transcripts (latest {sessions.length})</h3>
            {sessions.length === 0 && !loading && <p className="text-muted-foreground">No sessions found in the database.</p>}

            {sessions.map(session => {
                const title = `${new Date(session.updatedAt).toLocaleString()} ${session.userTag ? `(${session.userTag})` : ''}`;
                const transcript = (session.transcript as unknown as HistoryEntry[]) || [];

                return (
                    <CollapsibleSection key={session.id} title={title} className="bg-card shadow-sm">
                        <div className="space-y-4 text-sm">
                        {transcript.map((entry, idx) => (
                            <div key={idx} className="p-3 bg-background rounded-lg border border-border">
                                <p className="font-mono text-xs text-muted-foreground">ITEM: {entry.item_id}</p>
                                <div className="prose prose-sm max-w-none mt-1"><ReactMarkdown>{entry.text}</ReactMarkdown></div>
                                
                                <div className="mt-2 p-2 bg-white border rounded-md">
                                    <p><strong>Answer:</strong> <span className="italic">{entry.answer}</span></p>
                                    <div className="mt-1 pl-1 border-l-2 border-gray-200">
                                      <p className="text-xs text-muted-foreground">
                                        Label: <strong className="text-foreground">{entry.label}</strong>, Probe: <strong>{entry.probe_type}</strong>, θ: {Number(entry.theta_mean).toFixed(2)} (var: {Number(entry.theta_var).toFixed(2)})
                                      </p>
                                      <MetadataDisplay data={{ ...entry.pitfalls, ...entry.process_moves }} />
                                    </div>
                                </div>
                                
                                {entry.probe_answer && (
                                     <div className="mt-2 p-2 bg-primary-light border-primary-border text-primary-text rounded-md">
                                        <p className="font-semibold">Probe: {entry.probe_text}</p>
                                        <p><strong>Follow-up:</strong> <span className="italic">{entry.probe_answer}</span></p>
                                        <div className="mt-1 pl-1 border-l-2 border-blue-200">
                                            <p className="text-xs">
                                                Final Label: <strong>{entry.label}</strong>, Final θ: {Number(entry.probe_theta_update?.mean).toFixed(2)} (var: {Number(entry.probe_theta_update?.var).toFixed(2)})
                                            </p>
                                        </div>
                                     </div>
                                )}
                            </div>
                        ))}
                        </div>
                    </CollapsibleSection>
                )
            })}
        </section>

      {localLogs.length > 0 && (
        <CollapsibleSection title="Local Logs (Legacy)" className="bg-card shadow-sm mt-6 opacity-75">
            <div className="font-mono text-sm bg-gray-900 text-gray-400 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-72 shadow-inner">
                {JSON.stringify(localLogs.slice(0, 500), null, 2)}
            </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
