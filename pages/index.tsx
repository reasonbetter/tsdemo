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

// Define the state structure for when a probe is active
interface AwaitingProbeState {
  probeType: ProbeIntent;
  prompt: string;
  pending: {
    aj: AJJudgment;
    // The ID of the *next* item that will be shown after the probe is answered.
    next_item_id: string | null;
  };
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userTag, setUserTag] = useState("");

  // Ensure the initial item exists
  const initialItemId = bank.items[0]?.item_id;
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
  // Fallback prompts if the server doesn't provide one (safety net)
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

  async function logEvent(type: string, payload: Record<string, any>): Promise<void> {
    const entry = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      user_tag: userTag || null,
      type,
      ...payload
    };
    try { await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }); } catch {}
    try {
      const key = "rb_local_logs";
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      arr.push(entry);
      localStorage.setItem(key, JSON.stringify(arr).slice(0, 1_000_000));
    } catch {}
  }

  // --- API calls --------------------------------------------------------------

  // CRITICAL UPDATE: This function now retrieves the aj_guidance and passes it to the API
  async function callAJ({ item, userResponse, twType = null }: { item: ItemInstance, userResponse: string, twType?: ProbeIntent | null }): Promise<AJJudgment> {
    try {
      // Retrieve the guidance paragraph (New Requirement)
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

  async function callTurn({ itemId, ajMeasurement, twMeasurement = null }: { itemId: string, ajMeasurement: AJJudgment, twMeasurement?: AJJudgment | null }): Promise<TurnResult> {
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ajMeasurement, twMeasurement })
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
    if (!input.trim() || pending || !currentItem) return;
    setPending(true);

    const aj = await callAJ({ item: currentItem, userResponse: input });
    // Call the Orchestrator (Turn) with the AJ measurement
    const turn = await callTurn({ itemId: currentItem.item_id, ajMeasurement: aj });

    // Update history and logs
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
      // Log the pitfalls/moves for interpretability
      pitfalls: aj.pitfalls,
      process_moves: aj.process_moves
    });

    // Determine if a probe is required
    const prompt = probeTextFromServer(turn);
    const hasProbe = !!(turn.probe_type && turn.probe_type !== "None" && prompt);

    if (hasProbe) {
      setAwaitingProbe({
        probeType: turn.probe_type,
        prompt,
        // We store the AJ measurement and the *next* item ID determined by the orchestrator
        pending: { aj, next_item_id: turn.next_item_id }
      });
    } else {
      // If no probe, move to the next item ID returned by the orchestrator
      // If next_item_id is null, it means the test is over.
      setCurrentId(turn.next_item_id || "");
    }

    setInput("");
    setPending(false);
  }

  async function onSubmitProbe(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!awaitingProbe || !probeInput.trim() || pending || !currentItem) return;
    setPending(true);

    // Call AJ again to evaluate the probe response (Transcript Window - TW)
    const tw = await callAJ({
      item: currentItem,
      userResponse: probeInput,
      twType: awaitingProbe.probeType
    });

    // Call the Orchestrator again, providing both the original AJ measurement and the new TW measurement
    const merged = await callTurn({
      itemId: currentItem.item_id,
      ajMeasurement: awaitingProbe.pending.aj,
      twMeasurement: tw
    });

    // Update state based on the merged result
    setLog((lines) => [...lines, ...merged.trace, "—"]);
    setTheta({ mean: Number(merged.theta_mean.toFixed(2)), se: Number(Math.sqrt(merged.theta_var).toFixed(2)) });

    // The orchestrator returns the definitive next item after merging the evidence
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

  function endSession() {
    logEvent("session_end", { item_count: history.length });
    alert("Session ended. Visit /admin to view the log.");
    // Force the UI to update to the end state
     setCurrentId("");
  }

    // Helper function to reset the session for demo purposes
    async function resetSession() {
        // Trigger reset logic in the backend
        try {
            await fetch('/api/turn?reset=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        } catch (e) {
            console.error("Failed to reset backend session:", e);
        }
        const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        setSessionId(id);
        setCurrentId(initialItemId);
        setHistory([]);
        setLog([]);
        setTheta({ mean: 0, se: Math.sqrt(1.5) });
        setAwaitingProbe(null);
        setInput("");
        setProbeInput("");
        if (initialItemId) {
            logEvent("session_start", { item_id: initialItemId });
        }
    }

  // --- init -------------------------------------------------------------------
  useEffect(() => {
    // Initialize session on component mount
    resetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle cases where currentItem might be undefined (e.g., initialization or end of test)
  if (!currentItem) {
    // Check if history has items, indicating the test is complete
    if (history.length > 0 && !pending) {
        return (
            <div className="wrap">
                <h1 className="headline">Assessment Complete</h1>
                <p>Thank you for participating. Your session has ended.</p>
                <p>Final Theta Estimate: {theta.mean} (SE: {theta.se})</p>
                <button className="btn" onClick={resetSession}>Start New Session</button>
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
               {/* Added Reset button for easier testing */}
               <button type="button" className="btn btn-secondary" onClick={resetSession}>
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
