import { useEffect, useState } from "react";
// Import the Prisma type definition for the database model
import { LogEntry as DBLogEntry, Session } from "@prisma/client";
import { LogEntry as ClientLogEntry } from "@/types/assessment"; // Used only for local logs

// Define a helper type for the frontend display, ensuring payload is treated as an object
// and including the nested session data returned by the API.
type DisplayLogEntry = Omit<DBLogEntry, 'payload'> & {
    payload: Record<string, any>;
    // session might be null if the session was deleted but the log remained (though CASCADE delete prevents this)
    session: Pick<Session, 'userTag'> | null;
};

export default function Admin() {
  // Use the database DisplayLogEntry type
  const [serverLogs, setServerLogs] = useState<DisplayLogEntry[]>([]);
  // Keep local logs for comparison/backup during transition
  const [localLogs, setLocalLogs] = useState<ClientLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

    // 1. Fetch Server Logs (Now from the database)
    try {
      const res = await fetch("/api/log");
      if (res.ok) {
        const data = await res.json();
        // Ensure payload is correctly typed for display
        const logs = (data.logs || []).map((log: DBLogEntry & { session: Pick<Session, 'userTag'> | null }) => ({
            ...log,
            // Ensure payload is an object for safe access
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

    // 2. Fetch Local Logs (Backup/Demo)
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
    <div className="wrap">
      <h1 className="headline">Admin — Session Logs</h1>
      <p className="muted">
        Logs are now stored persistently in the Neon Postgres database.
      </p>

      {error && <div className="card" style={{background: '#fef2f2', color: '#b91c1c', marginBottom: 12}}>{error}</div>}


      <div className="row" style={{ marginBottom: 12 }}>
        <a className="link" href="/">← Back to Demo</a>
        <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
        </button>
        <button className="btn btn-secondary" onClick={() => downloadJSON(serverLogs, 'server')}>Download Server JSON</button>
        <button className="btn btn-secondary" onClick={() => downloadJSON(localLogs, 'local')}>Download Local JSON</button>
        <button className="btn btn-secondary" onClick={clearServer} style={{ color: '#dc2626' }}>Clear Database (All Data)</button>
        <button className="btn btn-secondary" onClick={clearLocal}>Clear Local</button>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Database Logs (latest {serverLogs.length})</h3>
        <div className="debug" style={{ maxHeight: 600 }}>
            {/* Display logs in a structured, readable format */}
            {serverLogs.map(log => (
                <div key={log.id} style={{marginBottom: '15px', borderBottom: '1px solid #334155', paddingBottom: '10px'}}>
                    <div>
                        <strong>Session:</strong> {log.sessionId.slice(0,8)} {log.session?.userTag ? `(${log.session.userTag})` : ''}
                        <span style={{float: 'right'}}>
                            <strong>TS:</strong> {new Date(log.timestamp).toLocaleString()}
                        </span>
                    </div>
                    <div><strong>Type:</strong> <span style={{color: '#60a5fa'}}>{log.type}</span></div>
                    {log.itemId && <div><strong>Item ID:</strong> {log.itemId}</div>}

                    {/* Display payload only if it has content */}
                    {Object.keys(log.payload).length > 0 && (
                        <pre style={{margin: '5px 0 0 0', color: '#94a3b8'}}>
                            {JSON.stringify(log.payload, null, 2)}
                        </pre>
                    )}
                </div>
            ))}
        </div>
      </section>

      {localLogs.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
            <h3>Local Logs (Legacy Backup - First 500)</h3>
            <div className="debug" style={{ maxHeight: 320, opacity: 0.7 }}>
                {/* Displaying raw JSON for local logs as the structure is less predictable */}
                {JSON.stringify(localLogs.slice(0, 500), null, 2)}
            </div>
        </section>
      )}
    </div>
  );
}
