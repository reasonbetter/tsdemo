import { useEffect, useState } from "react";
// Import the Prisma type definition for the database model
import { Session } from "@prisma/client";
import { LogEntry as ClientLogEntry } from "@/types/assessment"; // Used only for local logs
import { HistoryEntry } from "@/types/assessment";
import ReactMarkdown from 'react-markdown';

export default function Admin() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [localLogs, setLocalLogs] = useState<ClientLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // (Helper functions remain the same, implementation omitted for brevity)
  async function refresh() {
    setLoading(true);
    setError(null);

    // 1. Fetch Sessions from Server
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

    // 2. Fetch Local Logs
    try {
      const arr = JSON.parse(localStorage.getItem("rb_local_logs") || "[]") as ClientLogEntry[];
      // Sort local logs descending for consistency
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
    // Use Tailwind classes for layout and typography
    <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground mb-6">Admin — Session Logs</h1>
      <p className="text-muted-foreground mb-6">
        Logs are stored persistently in the Neon Postgres database.
      </p>

      {error && (
        // Error styling
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg mb-6" role="alert">
            {error}
        </div>
      )}


      {/* Action Bar */}
      <div className="flex flex-wrap gap-4 mb-8 items-center">
        <a className="text-primary hover:text-primary-hover font-medium text-sm mr-4" href="/">← Back to Demo</a>

        {/* Button Styling (Primary for Refresh) */}
        <button className="px-4 py-2 text-sm font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150" onClick={refresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
        </button>
        {/* Secondary Button Styling */}
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={() => downloadJSON(sessions, 'server-sessions')}>Download Sessions JSON</button>
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={() => downloadJSON(localLogs, 'local')}>Download Local JSON</button>
        {/* Danger Button Styling */}
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition duration-150" onClick={clearServer}>Clear Database (All Data)</button>
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={clearLocal}>Clear Local</button>
      </div>

      {/* Database Logs Section */}
        <section className="space-y-6">
            <h3 className="text-xl font-semibold">Session Transcripts (latest {sessions.length})</h3>
            {sessions.length === 0 && !loading && <p className="text-muted-foreground">No sessions found in the database.</p>}
            {sessions.map(session => (
                <div key={session.id} className="bg-card shadow-sm border border-border rounded-xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <div>
                            <h4 className="font-semibold text-lg">Session: {session.id.slice(0,8)}</h4>
                            {session.userTag && <p className="text-sm text-muted-foreground">User ID: {session.userTag}</p>}
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                            <p>Status: <span className="font-medium text-foreground">{session.status}</span></p>
                            <p>Last Updated: {new Date(session.updatedAt).toLocaleString()}</p>
                        </div>
                    </div>
                    
                    <div className="mt-4 border-t border-border pt-4">
                        <h5 className="font-semibold mb-2">Transcript</h5>
                        <div className="space-y-4 text-sm">
                        {(session.transcript as HistoryEntry[] || []).map((entry, idx) => (
                            <div key={idx} className="p-3 bg-background rounded-lg">
                                <p className="font-mono text-xs text-muted-foreground">ITEM: {entry.item_id}</p>
                                <div className="prose prose-sm max-w-none mt-1"><ReactMarkdown>{entry.text}</ReactMarkdown></div>
                                <p className="mt-2 p-2 bg-white border rounded-md"><strong>Answer:</strong> <span className="italic">{entry.answer}</span></p>
                                {entry.probe_answer && (
                                     <div className="mt-2 p-2 bg-primary-light border-primary-border text-primary-text rounded-md">
                                        <p className="font-semibold">Probe: {entry.probe_text}</p>
                                        <p><strong>Follow-up:</strong> <span className="italic">{entry.probe_answer}</span></p>
                                     </div>
                                )}
                            </div>
                        ))}
                        </div>
                    </div>
                </div>
            ))}
        </section>

      {/* Local Logs Section (Legacy) */}
      {localLogs.length > 0 && (
        <section className="bg-card shadow-sm border border-border rounded-xl p-6 mt-6 opacity-75">
            <h3 className="text-xl font-semibold mb-4">Local Logs (Legacy Backup - First 500)</h3>
            <div className="font-mono text-sm bg-gray-900 text-gray-400 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-72 shadow-inner">
                {JSON.stringify(localLogs.slice(0, 500), null, 2)}
            </div>
        </section>
      )}
    </div>
  );
}
