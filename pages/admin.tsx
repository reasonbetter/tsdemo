import { useEffect, useState } from "react";
// Import the Prisma type definition for the database model
import { LogEntry as DBLogEntry, Session } from "@prisma/client";
import { LogEntry as ClientLogEntry } from "@/types/assessment"; // Used only for local logs

// Define a helper type for the frontend display
type DisplayLogEntry = Omit<DBLogEntry, 'payload'> & {
    payload: Record<string, any>;
    session: Pick<Session, 'userTag'> | null;
};

export default function Admin() {
  // Use the database DisplayLogEntry type
  const [serverLogs, setServerLogs] = useState<DisplayLogEntry[]>([]);
  // Keep local logs for comparison/backup during transition
  const [localLogs, setLocalLogs] = useState<ClientLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // (Helper functions remain the same, implementation omitted for brevity)
  async function refresh() {
    setLoading(true);
    setError(null);

    // 1. Fetch Server Logs
    try {
      const res = await fetch("/api/log");
      if (res.ok) {
        const data = await res.json();
        const logs = (data.logs || []).map((log: DBLogEntry & { session: Pick<Session, 'userTag'> | null }) => ({
            ...log,
            payload: (log.payload && typeof log.payload === 'object' && !Array.isArray(log.payload)) ? log.payload : {}
        }));
        setServerLogs(logs);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.error("Error fetching server logs:", e);
      setError(`Failed to load server logs: ${(e as Error).message}`);
      setServerLogs([]);
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
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={() => downloadJSON(serverLogs, 'server')}>Download Server JSON</button>
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={() => downloadJSON(localLogs, 'local')}>Download Local JSON</button>
        {/* Danger Button Styling */}
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition duration-150" onClick={clearServer}>Clear Database (All Data)</button>
        <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={clearLocal}>Clear Local</button>
      </div>

      {/* Database Logs Section */}
      <section className="bg-card shadow-sm border border-border rounded-xl p-6 mt-6">
        <h3 className="text-xl font-semibold mb-4">Database Logs (latest {serverLogs.length})</h3>
        {/* Dark background log viewer */}
        <div className="font-mono text-sm bg-gray-900 rounded-lg p-4 overflow-auto max-h-[600px] shadow-inner">
            {serverLogs.length === 0 && !loading && <p className="text-gray-500">No logs found.</p>}
            {serverLogs.map(log => (
                <div key={log.id} className="mb-5 pb-4 border-b border-gray-700 last:border-b-0">
                    <div className="flex justify-between items-center text-gray-300">
                        <div>
                            <strong>Session:</strong> {log.sessionId.slice(0,8)} {log.session?.userTag ? <span className="text-xs text-gray-400">({log.session.userTag})</span> : ''}
                        </div>
                        <div className="text-xs text-gray-500">
                            <strong>TS:</strong> {new Date(log.timestamp).toLocaleString()}
                        </div>
                    </div>
                    <div className="mt-1">
                        <strong>Type:</strong> <span className="text-blue-400">{log.type}</span>
                    </div>
                    {log.itemId && <div className="mt-1 text-gray-400"><strong>Item ID:</strong> {log.itemId}</div>}

                    {/* Display payload only if it has content */}
                    {Object.keys(log.payload).length > 0 && (
                        <pre className="mt-2 text-gray-400 whitespace-pre-wrap bg-gray-800 p-3 rounded">
                            {JSON.stringify(log.payload, null, 2)}
                        </pre>
                    )}
                </div>
            ))}
        </div>
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
