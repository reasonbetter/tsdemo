import { useEffect, useMemo, useState, FormEvent } from "react";
// Using the path alias defined in tsconfig.json
import bankData from "@/data/itemBank.json";
import {
  ItemBank,
  ItemInstance,
  AJJudgment,
  AJFeatures,
  ProbeIntent,
  TurnResult,
  ThetaState,
  HistoryEntry,
  AJLabel
} from '@/types/assessment';

// Type assertion for the imported JSON data
const bank: ItemBank = bankData as ItemBank;

interface AwaitingProbeState {
  probeType: ProbeIntent;
  prompt: string;
  pending: {
    aj: AJJudgment;
    next_item_id: string | null;
  };
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInitialized, setSessionInitialized] = useState(false); // Track DB initialization
  const [userTag, setUserTag] = useState("");

  // Ensure the initial item exists
  const initialItemId = bank.items[0]?.item_id;
  // currentId starts with the initial item, but we wait for session initialization before proceeding
  const [currentId, setCurrentId] = useState<string>(initialItemId);

  const [input, setInput] = useState("");
  const [probeInput, setProbeInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [awaitingProbe, setAwaitingProbe] = useState<AwaitingProbeState | null>(null);
  const [theta, setTheta] = useState<ThetaState>({ mean: 0, se: Math.sqrt(1.5) });
  const [showDebug, setShowDebug] = useState(false);
  const [pending, setPending] = useState(false);

  const currentItem = useMemo(
    () => bank.items.find((it) => it.item_id === currentId),
    [currentId]
  );

  // --- helpers ----------------------------------------------------------------
  // (probePromptFor, probeTextFromServer remain the same)

  function probePromptFor(type: ProbeIntent): string {
    if (type === "Mechanism")
      return "One sentence: briefly explain the mechanism that could make this result misleading.";
    if (type === "Alternative")
      return "In a few words: give one different explanation for the link (not the one you already mentioned).";
    if (type === "Boundary")
      return "One sentence: name a condition where your conclusion would fail.";
    if (type === "Completion")
      return "Can you give one more different reason?";
    if (type === "Clarify")
      return "In one sentence: clarify what you meant.";
    return "";
  }

  function probeTextFromServer(turnPayload: TurnResult | undefined): string {
    const t = (turnPayload?.probe_text || "").trim();
    // Use the server text (AJ generated or Library fallback), or the client-side fallback as last resort
    return t.length > 0 ? t : probePromptFor(turnPayload?.probe_type || 'None');
  }

  async function logEvent(type: string, payload: Record<string, any>, specificSessionId?: string): Promise<void> {
    // Use the provided sessionId or the current state sessionId
    const sid = specificSessionId || sessionId;
    if (!sid) return;

    const entry = {
      ts: new Date().toISOString(),
      session_id: sid,
      user_tag: userTag || null,
      type,
      ...payload
    };
    // The /api/log endpoint will now handle database persistence (in Step 1.5)
    try { await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }); } catch {}

    // Keep local storage logging for backup/demo purposes
    try {
      const key = "rb_local_logs";
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      arr.push(entry);
      localStorage.setItem(key, JSON.stringify(arr).slice(0, 1_000_000));
    } catch {}
  }

  // --- API calls --------------------------------------------------------------

  // (callAJ remains the same)
  async function callAJ({ item, userResponse, twType = null }: { item: ItemInstance, userResponse: string, twType?: ProbeIntent | null }): Promise<AJJudgment> {
    try {
        // Retrieve the guidance paragraph
        const schemaFeatures = bank.schema_features[item.schema_id] || {};
        const ajGuidance = schemaFeatures.aj_guidance || undefined;

        const features: AJFeatures = {
          schema_id: item.schema_id,
          item_id: item.item_id,
          family: item.family,
          coverage_tag: item.coverage_tag,
          band: item.band,
          item_params: { a: item.a, b: item.b },
          // Determine direction word expectation based on family codes
          expect_direction_word: item.family.startsWith("C3") || item.family.startsWith("C6"),
          expected_list_count: item.family.startsWith("C1") ? 2 : undefined,
          tw_type: twType,
          aj_guidance: ajGuidance // Pass the guidance
        };

        const res = await fetch("/api/aj", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item,
            userResponse,
            features
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`AJ HTTP ${res.status}: ${text.slice(0, 800)}`);
        }
        return await res.json();
      } catch (e) {
        alert(`AJ error: ${(e as Error).message}`);
        // Return a fallback AJJudgment on error
        return {
          labels: { Novel: 1.0 } as Record<AJLabel, number>,
          pitfalls: {},
          process_moves: {},
          calibrations: { p_correct: 0.0, confidence: 0.2 },
          extractions: { direction_word: null, key_phrases: [] },
          probe: { intent: "None", text: "", rationale: "", confidence: 0.0 }
        };
      }
  }

  // Updated to include sessionId
  async function callTurn({ sessionId, itemId, ajMeasurement, twMeasurement = null }: { sessionId: string, itemId: string, ajMeasurement: AJJudgment, twMeasurement?: AJJudgment | null }): Promise<TurnResult> {
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Pass the sessionId to the backend
        body: JSON.stringify({ sessionId, itemId, ajMeasurement, twMeasurement })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Turn HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      alert(`Controller error: ${(e as Error).message}`);
      const nextSafe =
        bank.items.find((it) => it.item_id !== itemId)?.item_id || itemId;
      // Return a fallback TurnResult on error
      return {
        final_label: "Novel",
        probe_type: "None",
        probe_text: "",
        next_item_id: nextSafe,
        theta_mean: 0,
        theta_var: 1.5,
        coverage_counts: {},
        trace: [`Controller error: ${(e as Error).message}`]
      };
    }
  }

  // --- submit handlers --------------------------------------------------------
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Ensure sessionId is available before proceeding
    if (!input.trim() || pending || !currentItem || !sessionId) return;
    setPending(true);

    const aj = await callAJ({ item: currentItem, userResponse: input });
    // Pass sessionId to callTurn
    const turn = await callTurn({ sessionId, itemId: currentItem.item_id, ajMeasurement: aj });

    // (Rest of onSubmit remains the same)
    setHistory((h) => [
        ...h,
        {
          item_id: currentItem.item_id,
          text: currentItem.text,
          answer: input,
          label: turn.final_label,
          probe_type: turn.probe_type,
          probe_text: (turn.probe_text || ""),
          trace: turn.trace
        }
      ]);
      setLog((lines) => [...lines, ...turn.trace, "—"]);
      setTheta({ mean: Number(turn.theta_mean.toFixed(2)), se: Number(Math.sqrt(turn.theta_var).toFixed(2)) });

      await logEvent("item_answered", {
        item_id: currentItem.item_id,
        label: turn.final_label,
        probe_type: turn.probe_type,
        pitfalls: aj.pitfalls,
        process_moves: aj.process_moves
      });

      const prompt = probeTextFromServer(turn);
      const hasProbe = !!(turn.probe_type && turn.probe_type !== "None" && prompt);

      if (hasProbe) {
        setAwaitingProbe({
          probeType: turn.probe_type,
          prompt,
          pending: { aj, next_item_id: turn.next_item_id }
        });
      } else {
        // If next_item_id is null, set currentId to empty string to signify completion
        setCurrentId(turn.next_item_id || "");
      }

      setInput("");
      setPending(false);
  }

  async function onSubmitProbe(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Ensure sessionId is available before proceeding
    if (!awaitingProbe || !probeInput.trim() || pending || !currentItem || !sessionId) return;
    setPending(true);

    const tw = await callAJ({
      item: currentItem,
      userResponse: probeInput,
      twType: awaitingProbe.probeType
    });

    // Pass sessionId to callTurn
    const merged = await callTurn({
      sessionId,
      itemId: currentItem.item_id,
      ajMeasurement: awaitingProbe.pending.aj,
      twMeasurement: tw
    });

     // (Rest of onSubmitProbe remains the same)
    setLog((lines) => [...lines, ...merged.trace, "—"]);
    setTheta({ mean: Number(merged.theta_mean.toFixed(2)), se: Number(Math.sqrt(merged.theta_var).toFixed(2)) });

    // If next_item_id is null, set currentId to empty string to signify completion
    setCurrentId(merged.next_item_id || "");

    setHistory((h) => {
      const last = h[h.length - 1];
      const updated: HistoryEntry = { ...last, probe_answer: probeInput, probe_label: awaitingProbe.probeType };
      return [...h.slice(0, -1), updated];
    });

    await logEvent("probe_answered", {
      item_id: currentItem.item_id,
      probe_type: awaitingProbe.probeType
    });

    setAwaitingProbe(null);
    setProbeInput("");
    setPending(false);
  }

  // --- Session Management (Updated) ---

    // Initialize or reset the session
    async function initializeSession() {
        setSessionInitialized(false); // Start initialization process
        
        // 1. Generate a client-side UUID
        const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        
        // 2. Reset local state
        setSessionId(id);
        setCurrentId(initialItemId);
        setHistory([]);
        setLog([]);
        // We will set theta based on the server response
        setAwaitingProbe(null);
        setInput("");
        setProbeInput("");

        // 3. Create the session record in the database
        try {
            const res = await fetch('/api/create_session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Pass the generated ID and the userTag (if any)
                body: JSON.stringify({ sessionId: id, userTag: userTag || null })
            });

            if (!res.ok) {
                throw new Error("Failed to initialize session in database.");
            }

            const sessionData = await res.json();

            // Set the initial theta state based on the DB defaults
            setTheta({
                mean: Number(sessionData.thetaMean.toFixed(2)),
                se: Number(Math.sqrt(sessionData.thetaVar).toFixed(2))
            });

            setSessionInitialized(true); // Mark initialization as complete

            if (initialItemId) {
                // We must manually log the first event here because logEvent relies on the sessionId state, 
                // which might not have updated synchronously yet.
                const startEvent = {
                    ts: new Date().toISOString(),
                    session_id: id, // Use the locally generated ID
                    user_tag: userTag || null,
                    type: "session_start",
                    item_id: initialItemId
                };
                // This still uses the ephemeral logger, to be updated in 1.5
                await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(startEvent) });
            }
        } catch (e) {
            console.error("Session initialization failed:", e);
            alert("Error initializing session. Please check the database connection.");
            setSessionId(null);
            setSessionInitialized(true); // Allow UI to show error state
        }
    }

    async function endSession() {
        // We rely on the backend (turn.ts) to mark the session COMPLETED when no more items are available.
        // This button provides a manual override/logging point.
        logEvent("session_end_manual", { item_count: history.length });
        alert("Session ended. Visit /admin to view the log.");
         setCurrentId("");
      }

  // --- init -------------------------------------------------------------------
  useEffect(() => {
    // Initialize session on component mount
    initializeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle loading states and completion
  if (!sessionInitialized) {
    return <div className="wrap">Initializing session...</div>;
  }

  if (!sessionId) {
    return <div className="wrap">Session initialization failed. Please try refreshing the page.</div>;
  }

  if (!currentItem) {
    // Check if history has items, indicating the test is complete
    if (history.length > 0 && !pending) {
        return (
            <div className="wrap">
                <h1 className="headline">Assessment Complete</h1>
                <p>Thank you for participating. Your session has ended.</p>
                <p>Final Theta Estimate: {theta.mean} (SE: {theta.se})</p>
                {/* The "Reset" button now calls initializeSession */}
                <button className="btn" onClick={initializeSession}>Start New Session</button>
                <a className="link" href="/admin" style={{ marginLeft: 12 }}>View Admin Logs</a>
            </div>
        );
    }
     // Handle empty item bank
     if (!initialItemId) {
        return <div className="wrap">Error: Item Bank is empty or failed to load. Check data/itemBank.json.</div>;
    }
    return <div className="wrap">Loading...</div>;
  }


  // --- render -----------------------------------------------------------------
  // (The render return block remains the same as Step 1.2 implementation)
  return (
    <div className="wrap">
      <h1 className="headline">Reasoning Demo — Causal Structure (Pilot)</h1>

      <div className="subhead">
        <span className="badge"><strong>θ</strong>&nbsp;{theta.mean}</span>
        <span className="badge"><strong>SE</strong>&nbsp;{theta.se}</span>
        <span className="badge">Item: {currentItem.item_id}</span>
        <span className="badge">Tag: {currentItem.coverage_tag}</span>
        <span className="badge">Session: {sessionId?.slice(0, 8)}</span>
        <span className="badge">
          <label className="muted" style={{ marginRight: 6 }}>Your initials</label>
          {/* Note: Updating userTag here doesn't retroactively update the DB session record yet, but will be used if they hit Reset */}
          <input className="input" style={{ width: 110, padding: "6px 8px" }} value={userTag} onChange={(e) => setUserTag(e.target.value)} placeholder="optional" />
        </span>
        <a className="link" href="/admin" title="Admin log" style={{ marginLeft: "auto" }}>Admin</a>
      </div>

      <div className="spacer" />

      <section className="card">
        <p className="question">{currentItem.text}</p>

        {!awaitingProbe && (
          <form onSubmit={onSubmit}>
            <textarea
              className="textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Your answer (few words or one sentence)"
              rows={2}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button type="submit" className="btn" disabled={pending}>Submit</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDebug((s) => !s)}>
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={endSession}>
                End Session
              </button>
               {/* Reset button now calls initializeSession */}
               <button type="button" className="btn btn-secondary" onClick={initializeSession}>
                Reset
              </button>
            </div>
          </form>
        )}

        {awaitingProbe && (
          <form onSubmit={onSubmitProbe}>
            <div className="probe" style={{ marginBottom: 8 }}>{awaitingProbe.prompt}</div>
            <input
              className="input"
              value={probeInput}
              onChange={(e) => setProbeInput(e.target.value)}
              placeholder="One sentence"
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button type="submit" className="btn" disabled={pending}>Submit follow‑up</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDebug((s) => !s)}>
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
            </div>
          </form>
        )}
      </section>

       {/* (Debug and History sections remain the same) */}
       {showDebug && (
        <section style={{ marginTop: 24 }}>
          <h3>Session Trace (debug)</h3>
          <div className="debug">{log.join("\n")}</div>
          {/* Display the AJ Guidance for the current item */}
          <h4>Current Item Guidance (AJ)</h4>
          <div className="debug" style={{ background: '#1e293b', color: '#94a3b8', maxHeight: '150px'}}>
            {bank.schema_features[currentItem.schema_id]?.aj_guidance || "No specific guidance."}
          </div>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h3>History</h3>
        {history.map((h, index) => (
          // Use a unique key combining item_id and index
          <div key={`${h.item_id}-${index}`} className="historyItem">
            <div><strong>{h.item_id}</strong> — {h.label} {h.probe_type !== "None" ? `(probe: ${h.probe_type})` : ""}</div>
            <div className="muted">{h.text}</div>
            <div><em>Ans:</em> {h.answer}</div>
            {h.probe_answer && <div><em>Probe:</em> {h.probe_answer}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}
