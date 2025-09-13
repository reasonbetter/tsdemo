import { useEffect, useMemo, useState, FormEvent, useRef, useCallback } from "react";
import ReactMarkdown from 'react-markdown';
import bankData from "@/data/itemBank.json";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  ItemBank, ItemInstance, AJJudgment, AJFeatures, ProbeIntent, TurnResult, ThetaState, HistoryEntry, AJLabel
} from '@/types/assessment';

const bank: ItemBank = bankData as ItemBank;

interface AwaitingProbeState {
  probeType: ProbeIntent;
  prompt: string;
  pending: {
    aj: AJJudgment;
    next_item_id: string | null;
  };
}

// Helper component for rendering markdown prompts professionally
const Prose = ({ children, size = 'lg' }: { children: string, size?: 'sm' | 'lg' }) => (
    <div className={`${size === 'lg' ? 'text-lg leading-relaxed' : 'text-base leading-normal'} text-foreground mb-6 [&>p]:mb-4 [&>ul]:list-disc [&>ul]:pl-5 [&>li]:mb-2`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );


export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [userTag, setUserTag] = useState("");
// New state to track if the session has been saved to the DB
  const [isSessionLive, setIsSessionLive] = useState(false);
  // State for the User ID input field itself
  const [userIdInput, setUserIdInput] = useState("");


  const triageItems = bank.items.filter(it => it.band === 'Triage');
  const initialItemId = triageItems[Math.floor(Math.random() * triageItems.length)]?.item_id;
  const [currentId, setCurrentId] = useState<string>(initialItemId);

  const [input, setInput] = useState("");
  const [probeInput, setProbeInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [awaitingProbe, setAwaitingProbe] = useState<AwaitingProbeState | null>(null);
  const [theta, setTheta] = useState<ThetaState>({ mean: 0, se: Math.sqrt(1.5) });
  const [pending, setPending] = useState(false);

  // State for sidebar visibility
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  // Refs for dynamic autofocus
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const probeInputRef = useRef<HTMLInputElement>(null);

  // Autofocus implementation
  useEffect(() => {
      if (!pending) {
        if (awaitingProbe) {
            probeInputRef.current?.focus();
        } else if (currentId) {
            inputRef.current?.focus();
        }
      }
  }, [awaitingProbe, pending, currentId]);


  const currentItem = useMemo(
    () => bank.items.find((it) => it.item_id === currentId),
    [currentId]
  );

  // --- helpers, API calls, submit handlers ----------------------------------------------------------------
  // (Helper functions remain the same, implementation omitted for brevity)
    function probePromptFor(type: ProbeIntent): string {
        if (type === "Mechanism") return "One sentence: briefly explain the mechanism.";
        if (type === "Alternative") return "In a few words: give one different explanation.";
        if (type === "Boundary") return "One sentence: name a condition where your conclusion would fail.";
        if (type === "Completion") return "Can you give one more different reason?";
        if (type === "Clarify") return "In one sentence: clarify what you meant.";
        return "";
    }

    function probeTextFromServer(turnPayload: TurnResult | undefined): string {
        const t = (turnPayload?.probe_text || "").trim();
        return t.length > 0 ? t : probePromptFor(turnPayload?.probe_type || 'None');
    }

    async function logEvent(type: string, payload: Record<string, any>, specificSessionId?: string): Promise<void> {
        const sid = specificSessionId || sessionId;
        if (!sid) return;

        const entry = {
            ts: new Date().toISOString(),
            session_id: sid,
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

    async function callAJ({ item, userResponse, twType = null }: { item: ItemInstance, userResponse: string, twType?: ProbeIntent | null }): Promise<AJJudgment> {
        try {
             const schemaFeatures = bank.schema_features[item.schema_id] || {};
            const ajGuidance = schemaFeatures.aj_guidance || undefined;

            const features: AJFeatures = {
                schema_id: item.schema_id,
                item_id: item.item_id,
                band: item.band,
                item_params: { a: item.a, b: item.b },
                expect_direction_word: item.schema_id.startsWith("P2_M1_S3") || item.schema_id.startsWith("P2_M1_S6"),
                expected_list_count: item.schema_id.startsWith("P2_M1_S1") ? 2 : undefined,
                tw_type: twType,
                aj_guidance: ajGuidance
            };

            const res = await fetch("/api/aj", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ item, userResponse, features })
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`AJ HTTP ${res.status}: ${text.slice(0, 800)}`);
            }
            return await res.json();
        } catch (e) {
            alert(`AJ error: ${(e as Error).message}`);
             return {
                score: 0.0,
                final_label: "Novel",
                tags: [],
                probe: { intent: "None", text: "", rationale: "", confidence: 0.0 }
            };
        }
    }

    async function callTurn({ sessionId, itemId, ajMeasurement, twMeasurement = null, userResponse, probeResponse, probeType }: { sessionId: string, itemId: string, ajMeasurement: AJJudgment, twMeasurement?: AJJudgment | null, userResponse: string, probeResponse?: string, probeType?: ProbeIntent }): Promise<TurnResult> {
        try {
            const res = await fetch("/api/turn", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, itemId, ajMeasurement, twMeasurement, userResponse, probeResponse, probeType })
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

    async function onSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!input.trim() || pending || !currentItem || !sessionId) return;
        setPending(true);

// If this is the first submission, create the session in the DB first
        if (!isSessionLive) {
            try {
                const res = await fetch('/api/create_session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, userTag: userTag || null })
                });
                if (!res.ok) {
                    throw new Error("Failed to create session in database before first turn.");
                }
                setIsSessionLive(true); // Mark session as live
            } catch (e) {
                alert(`Error creating session: ${(e as Error).message}`);
                setPending(false);
                return;
            }
        }

        const aj = await callAJ({ item: currentItem, userResponse: input });
        const turn = await callTurn({ sessionId, itemId: currentItem.item_id, ajMeasurement: aj, userResponse: input });


        setHistory((h) => [
            ...h,
            {
                item_id: currentItem.item_id,
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
            setCurrentId(turn.next_item_id || "");
        }

        setInput("");
        setPending(false);
    }

    async function onSubmitProbe(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!awaitingProbe || !probeInput.trim() || pending || !currentItem || !sessionId) return;
        setPending(true);

        const lastHistory = history[history.length - 1];
        if (!lastHistory) return; 
      
        const tw = await callAJ({
            item: currentItem,
            userResponse: probeInput,
            twType: awaitingProbe.probeType
        });

        const merged = await callTurn({
            sessionId,
            itemId: currentItem.item_id,
            ajMeasurement: awaitingProbe.pending.aj,
            twMeasurement: tw,
            userResponse: lastHistory.answer,
            probeResponse: probeInput,
            probeType: awaitingProbe.probeType,
        });

        setLog((lines) => [...lines, ...merged.trace, "—"]);
        setTheta({ mean: Number(merged.theta_mean.toFixed(2)), se: Number(Math.sqrt(merged.theta_var).toFixed(2)) });

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


  // --- Session Management -----------------------------------------------------

    // Function to update User ID in the database (called on input blur)
    const updateUserId = useCallback(async (newUserId: string) => {
        if (!sessionId || newUserId === userTag) return;

        setUserTag(newUserId); // Update the local state optimistically

        try {
            const res = await fetch('/api/update_session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, userTag: newUserId })
            });

            if (!res.ok) {
                throw new Error("Failed to update User ID in database.");
            }
            // Confirmation handled visually in the render block
        } catch (e) {
            console.error("User ID update failed:", e);
            // If update fails, revert the local state
            setUserTag(userTag);
            setUserIdInput(userTag);
            alert("Error updating User ID.");
        }
    }, [sessionId, userTag]);


    async function initializeSession() {
        setSessionInitialized(false);
        const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());

        setSessionId(id);
        setCurrentId(initialItemId);
        setHistory([]);
        setLog([]);
        setAwaitingProbe(null);
        setInput("");
        setProbeInput("");
        setIsSessionLive(false); // Reset the session live status

        // Use the current value of the input field when resetting
        const currentUserTag = userIdInput.trim() === '' ? null : userIdInput.trim();
        setUserTag(currentUserTag || "");

  setTheta({ mean: 0, se: Math.sqrt(1.5) });
   setSessionInitialized(true);

    }

    async function endSession() {
        logEvent("session_end_manual", { item_count: history.length });
        alert("Session ended. Visit /admin to view the log.");
         setCurrentId("");
      }

  useEffect(() => {
    initializeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Loading/Error States ---------------------------------------------------
   if (!sessionInitialized) {
    return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-muted-foreground">Initializing session...</div>;
  }

  if (!sessionId) {
    return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-red-600">Session initialization failed. Please try refreshing the page.</div>;
  }

  if (!currentItem) {
    if (history.length > 0 && !pending) {
        // Completion Screen (Remains the same, centered layout)
        return (
            <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground mb-6">Assessment Complete</h1>
                <div className="bg-card shadow-sm border border-border rounded-xl p-6 mb-6">
                    <p className="text-lg mb-4">Thank you for participating. Your session has ended.</p>
                    <p className="text-lg font-semibold">Final Theta Estimate: {theta.mean} (SE: {theta.se})</p>
                </div>
                <div className="flex gap-4">
                    <button className="px-6 py-2 text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover transition duration-150" onClick={initializeSession}>Start New Session</button>
                    <a className="px-6 py-2 text-base font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150 inline-flex items-center" href="/admin">View Admin Logs</a>
                </div>
            </div>
        );
    }
     if (!initialItemId) {
        return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-red-600">Error: Item Bank is empty or failed to load.</div>;
    }
    return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-muted-foreground">Loading...</div>;
  }


  // --- render (The Focused Interview Layout) -----------------------------------------------------------------
  return (
    // Use a wider max-width (max-w-6xl) for the two-column layout
    <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8">

       {/* Header */}
       <header className="flex justify-between items-center mb-8">
            <div>
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
                    Reasoning Interviewer
                </h1>
                <p className="text-base text-muted-foreground">
                    Demo—Pillar 2, Module 1, Triage Questions Only
                </p>
            </div>
            <div className="flex items-center gap-4">
                {/* Sidebar Toggle Button */}
                <button
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150"
                    onClick={() => setIsSidebarVisible(!isSidebarVisible)}
                >
                    {isSidebarVisible ? 'Hide Details' : 'Show Details'}
                </button>
                <a className="text-primary hover:text-primary-hover font-medium text-sm" href="/admin" title="Admin log">Admin</a>
            </div>
       </header>


       {/* Main Grid Layout (Responsive) */}
       <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

            {/* Main Content Area (8 columns) */}
            {/* When sidebar is hidden, this area expands to 12 columns */}
            <main className={`transition-all duration-300 ${isSidebarVisible ? 'lg:col-span-8' : 'lg:col-span-12 max-w-4xl mx-auto w-full'}`}>

                {/* Main Assessment Card */}
                <section className="bg-card shadow-lg border border-border rounded-xl p-6 mb-8">

                    {/* Question Prompt */}
                    <Prose>{currentItem.text}</Prose>

                    {!awaitingProbe && (
                    <form onSubmit={onSubmit}>
                        <textarea
                        ref={inputRef}
                        className="w-full px-4 py-3 text-base border border-input-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition duration-150 ease-in-out resize-vertical"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Your answer (few words or one sentence)"
                        rows={3}
                        />
                        <div className="flex flex-wrap gap-3 mt-4">
                        <button type="submit" className="px-6 py-2 text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150" disabled={pending}>
                            {pending ? 'Processing...' : 'Submit'}
                        </button>
                        <button type="button" className="px-6 py-2 text-base font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={endSession}>
                            End Session
                        </button>
                        <button type="button" className="px-6 py-2 text-base font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={initializeSession}>
                            Reset
                        </button>
                        </div>
                    </form>
                    )}

                    {awaitingProbe && (
                    <form onSubmit={onSubmitProbe}>
                        {/* Probe Styling (Blue highlight) */}
                        <div className="bg-primary-light border border-primary-border text-primary-text p-4 rounded-lg italic mb-4">
                            {awaitingProbe.prompt}
                        </div>
                        <input
                        ref={probeInputRef}
                        className="w-full px-4 py-3 text-base border border-input-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary transition duration-150 ease-in-out"
                        value={probeInput}
                        onChange={(e) => setProbeInput(e.target.value)}
                        placeholder="One sentence"
                        />
                        <div className="flex flex-wrap gap-3 mt-4">
                        <button type="submit" className="px-6 py-2 text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150" disabled={pending}>
                            {pending ? 'Processing...' : 'Submit follow-up'}
                        </button>
                        </div>
                    </form>
                    )}
                </section>

                {/* Transcript History (Collapsible, Closed by Default, In Main Column) */}
                {history.length > 0 && (
                    <CollapsibleSection title="Transcript History" className="bg-card shadow-sm">
                        <div className="space-y-8">
                            {history.map((h, index) => (
                            <div key={`${h.item_id}-${index}`} className="border-t border-border pt-6 first:pt-0 first:border-t-0">
                                <div className="flex justify-between items-center mb-4">
                                    <strong className="text-foreground">Item: {h.item_id}</strong>
                                    {/* Color-coded correctness tag */}
                                    <span className={`text-sm font-medium px-3 py-1 rounded-full ${h.label.startsWith('Correct') ? 'bg-green-100 text-green-800' : h.label === 'Partial' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                        {h.label}
                                    </span>
                                </div>

                                {/* Transcript View */}
                                <div className="space-y-4">
                                    <div className="text-muted-foreground">
                                        <strong className="block mb-1 text-foreground">Interviewer:</strong>
                                        <Prose size="sm">{h.text}</Prose>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <strong className="block mb-1 text-foreground">Subject:</strong>
                                        <p className="italic text-foreground">{h.answer}</p>
                                    </div>

                                    {h.probe_type !== "None" && h.probe_text && (
                                        <div className="text-muted-foreground">
                                            <strong className="block mb-1 text-foreground">Interviewer (Probe):</strong>
                                            <p className="text-sm italic">{h.probe_text}</p>
                                        </div>
                                    )}

                                    {h.probe_answer && (
                                         <div className="p-3 bg-gray-50 rounded-lg">
                                            <strong className="block mb-1 text-foreground">Subject (Response):</strong>
                                            <p className="italic text-foreground">{h.probe_answer}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            ))}
                        </div>
                    </CollapsibleSection>
                )}

            </main>

            {/* Sidebar (4 columns, Conditionally Rendered) */}
            {/* The sidebar slides in/out based on visibility state */}
            <aside className={`lg:col-span-4 transition-all duration-300 ease-in-out ${isSidebarVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full lg:hidden'}`}>
                <div className="space-y-6">
                    {/* User ID Input */}
                    <div className="p-4 bg-card border border-border rounded-xl shadow-sm">
                        <label className="text-base font-medium text-foreground block mb-2">User ID (optional)</label>
                        <div className="flex items-center gap-3">
                            <input
                                className="flex-grow px-3 py-2 text-base border border-input-border rounded-lg focus:ring-primary focus:border-primary transition duration-150"
                                value={userIdInput}
                                onChange={(e) => setUserIdInput(e.target.value)}
                                // Update the database when the user stops typing and leaves the field (onBlur)
                                onBlur={(e) => updateUserId(e.target.value)}
                                placeholder="Enter ID"
                            />
                            {/* Visual confirmation when saved (input value matches the saved userTag) */}
                            {userIdInput === userTag && userTag !== "" && (
                              <svg className="w-5 h-5 text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
  <title>ID Saved</title>
  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L9 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
</svg>
                            )}
                        </div>
                    </div>


                    {/* Session Info (Collapsible, Closed by Default) */}
                    <CollapsibleSection title="Session Info" titleSize="sm" className="bg-card shadow-sm">
                        <div className="flex flex-wrap gap-3">
                            <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground bg-background border border-border rounded-full"><strong>θ</strong> {theta.mean}</span>
                            <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground bg-background border border-border rounded-full"><strong>SE</strong> {theta.se}</span>
                            <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground bg-background border border-border rounded-full">Item: {currentItem.item_id}</span>
                            <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground bg-background border border-border rounded-full">Tag: {bank.schema_features[currentItem.schema_id]?.coverage_tag}</span>
                        </div>
                         <p className="text-xs text-muted-foreground mt-3">Session ID: {sessionId}</p>
                    </CollapsibleSection>

                    {/* Current Item Guidance (Collapsible, Closed by Default) */}
                    <CollapsibleSection title="Item Guidance (AJ)" titleSize="sm" className="bg-card shadow-sm">
                        <div className="font-mono text-sm bg-gray-800 text-gray-400 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-60 shadow-inner">
                            {bank.schema_features[currentItem.schema_id]?.aj_guidance || "No specific guidance."}
                        </div>
                    </CollapsibleSection>

                    {/* Session Trace (Collapsible, Closed by Default) */}
                    <CollapsibleSection title="Session Trace (Debug)" titleSize="sm" className="bg-card shadow-sm">
                        <div className="font-mono text-sm bg-gray-900 text-blue-200 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-80 shadow-inner">
                            {log.length === 0 ? "Trace log is empty." : log.join("\n")}
                        </div>
                    </CollapsibleSection>
                </div>
            </aside>
       </div>
    </div>
  );
}
