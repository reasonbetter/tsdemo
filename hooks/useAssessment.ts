import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TranscriptEntry, DisplayTheta } from '@/types/kernel';
import { getDisplayTheta, formatOutgoingTraceForDisplay } from '@/lib/utils';
import { DEFAULT_TRANSITION_DELAY_MS, nextTransitionPhrase, resetTransitionPhrases } from '../utils/transitionPhrases';
import { apiGetItems, apiPatchUpdateSession, apiPostAJTurn, apiPostTurn } from '@/lib/apiClient';

export type SelectedItem = { isKernel: boolean; ItemID: string; SchemaID: string; Stem: string } | null;

export interface AwaitingProbeState {
  prompt: string;
  initial_answer: string;
}

function defaultTheta(): DisplayTheta { return { mean: 0, se: Math.sqrt(1.5) }; }


export function useAssessment() {
  // --- Core UI / domain state ---
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [input, setInput] = useState<string>('');
  const [probeInput, setProbeInput] = useState('');
  const [history, setHistory] = useState<TranscriptEntry[]>([]);
  const [awaitingProbe, setAwaitingProbe] = useState<AwaitingProbeState | null>(null);
  const [awaitingTransition, setAwaitingTransition] = useState<string | null>(null);
  const [theta, setTheta] = useState<DisplayTheta>(defaultTheta());
  const [pending, setPending] = useState(false);
  const [latestMeasurement, setLatestMeasurement] = useState<any | null>(null);
  const [ellipsisCount, setEllipsisCount] = useState(1);

  const [bankItems, setBankItems] = useState<any[]>([]);
  const [itemsBySchema, setItemsBySchema] = useState<Record<string, any[]>>({});
  const [schemaOrder, setSchemaOrder] = useState<string[]>([]);
  const [schemaIndex, setSchemaIndex] = useState<number>(0);
  // Session plan: exactly 4 questions -> 2 AEG, 1 BDO, 1 SEI (random order)
  const [sessionPlanSchemas, setSessionPlanSchemas] = useState<string[]>([]);
  const [sessionStepIndex, setSessionStepIndex] = useState<number>(0); // index within session plan
  const [usedItemsBySchema, setUsedItemsBySchema] = useState<Record<string, Set<string>>>({});
  const [usedMutExGroups, setUsedMutExGroups] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [outgoingTurnTrace, setOutgoingTurnTrace] = useState<string>('Trace available after first kernel AJ call.');
  const [seenKernelIds, setSeenKernelIds] = useState<string[]>([]);

  const [isSessionLive, setIsSessionLive] = useState(false);
  const [userIdInput, setUserIdInput] = useState('');
  const [userTag, setUserTag] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const [showSessionEndOverlay, setShowSessionEndOverlay] = useState(false);
  const [capByDriverId, setCapByDriverId] = useState<Record<string, { usesProbes?: boolean; continuousScore?: boolean }>>({});
  const [currentDriverId, setCurrentDriverId] = useState<string | null>(null);
  const STORAGE_KEY = 'ri.session.v1';
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  // Helper: convert kernel theta vector to display form via utils

  // Animated ellipsis
  useEffect(() => {
    let interval: any;
    if (pending) {
      interval = setInterval(() => setEllipsisCount((c) => (c >= 3 ? 1 : c + 1)), 500);
    } else {
      setEllipsisCount(1);
    }
    return () => interval && clearInterval(interval);
  }, [pending]);

  // Restore session from localStorage (before fetching items)
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw || 'null');
      if (!saved || !saved.sessionId || !saved.selectedItem) return;
      setSessionId(saved.sessionId as string);
      setUserTag(saved.userTag || '');
      setSelectedItem(saved.selectedItem as SelectedItem);
      setSessionPlanSchemas(Array.isArray(saved.sessionPlanSchemas) ? saved.sessionPlanSchemas : []);
      setSessionStepIndex(Number.isFinite(saved.sessionStepIndex) ? saved.sessionStepIndex : 0);
      // Rehydrate sets
      const usedMap: Record<string, Set<string>> = {};
      if (saved.usedItemsBySchema && typeof saved.usedItemsBySchema === 'object') {
        for (const k of Object.keys(saved.usedItemsBySchema)) {
          usedMap[k] = new Set<string>(saved.usedItemsBySchema[k] || []);
        }
      }
      setUsedItemsBySchema(usedMap);
      setUsedMutExGroups(new Set<string>((saved.usedMutExGroups || []) as string[]));
      setSeenKernelIds(Array.isArray(saved.seenKernelIds) ? saved.seenKernelIds : []);
      setSessionInitialized(true);
      setRestoredFromStorage(true);
    } catch {}
  }, []);

  // Load kernel items on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await apiGetItems();
        // Exclude generic numeric Fermi items and set BDS aside for now
        const items = raw.filter((it: any) => it.SchemaID !== 'FermiPopulationCity' && it.SchemaID !== 'BiasDirectionSequential');
        if (cancelled) return;
        setBankItems(items);
        // Build items-by-schema mapping and randomize schema order once
        const bySchema: Record<string, any[]> = {};
        for (const it of items) { if (!bySchema[it.SchemaID]) bySchema[it.SchemaID] = []; bySchema[it.SchemaID].push(it); }
        setItemsBySchema(bySchema);
        if (restoredFromStorage) {
          // Respect restored selection/plan; do not reset order/plan
          const ids = Object.keys(bySchema);
          const randomized = [...ids].sort(() => Math.random() - 0.5);
          setSchemaOrder(randomized);
        } else {
          const ids = Object.keys(bySchema);
          const randomized = [...ids].sort(() => Math.random() - 0.5);
          setSchemaOrder(randomized);
          setSchemaIndex(0);
          setUsedItemsBySchema({});
          // Build per-session plan: 2 AEG, 1 BDO, 1 SEI (random order)
          const AEG = 'AlternativeExplanationGeneration';
          const BDO = 'BiasDirectionOpen';
          const SEI = 'SelectionEffectIdentification';
          const plan = [AEG, AEG, BDO, SEI].sort(() => Math.random() - 0.5);
          setSessionPlanSchemas(plan);
          setSessionStepIndex(0);
        }
        if (!restoredFromStorage && items.length > 0 && (!selectedItem || !selectedItem.isKernel)) {
          // pick first item from the first schema in the plan
          const initialPlan = sessionPlanSchemas && sessionPlanSchemas.length > 0
            ? sessionPlanSchemas
            : ['AlternativeExplanationGeneration', 'AlternativeExplanationGeneration', 'BiasDirectionOpen', 'SelectionEffectIdentification'];
          const sid = initialPlan[0];
          const pool = (bySchema[sid] ?? []);
          if (pool.length > 0) {
            const pick = pool[Math.floor(Math.random() * pool.length)];
            setSelectedItem({ ItemID: pick.ItemID, SchemaID: pick.SchemaID, Stem: pick.Stem, isKernel: true });
            setSeenKernelIds((s) => (s.includes(pick.ItemID) ? s : [...s, pick.ItemID]));
            setUsedItemsBySchema({ [sid]: new Set([pick.ItemID]) });
            if ((pick as any).MutuallyExclusiveGroup) setUsedMutExGroups(new Set([(pick as any).MutuallyExclusiveGroup]));
          }
        }
      } catch (e) {
        // non-fatal for demo
        setDebugLog((lines) => [...lines, `[items] error: ${(e as Error).message}`]);
      }
      // Fetch registry capabilities
      try {
        const res = await fetch('/api/registry_health');
        const data = await res.json().catch(() => null);
        const drivers = data?.drivers || [];
        const map: Record<string, { usesProbes?: boolean; continuousScore?: boolean }> = {};
        for (const d of drivers) {
          map[d.id] = { usesProbes: d?.capabilities?.usesProbes, continuousScore: d?.capabilities?.continuousScore };
        }
        if (!cancelled) setCapByDriverId(map);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [restoredFromStorage]);

  const pickNextItem = useCallback((prev?: SelectedItem) => {
    // Prefer session plan sequence if available
    const AEG = 'AlternativeExplanationGeneration';
    const BDO = 'BiasDirectionOpen';
    const SEI = 'SelectionEffectIdentification';

    const computePool = (sid: string) => {
      const all = itemsBySchema[sid] ?? [];
      const used = usedItemsBySchema[sid] ?? new Set<string>();
      return all.filter((it: any) => {
        if (used.has(it.ItemID)) return false;
        const meWith: string[] = (it as any).MutuallyExclusiveWith ?? [];
        if (meWith.some((id) => seenKernelIds.includes(id))) return false;
        const grp: string | undefined = (it as any).MutuallyExclusiveGroup;
        if (grp && usedMutExGroups.has(grp)) return false;
        return true;
      });
    };

    const selectAndSet = (sid: string, nextIdx: number | null) => {
      const pool = computePool(sid);
      if (pool.length === 0) return false;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setSelectedItem({ ItemID: pick.ItemID, SchemaID: pick.SchemaID, Stem: pick.Stem, isKernel: true });
      setSeenKernelIds((s) => (s.includes(pick.ItemID) ? s : [...s, pick.ItemID]));
      setUsedItemsBySchema((prevMap) => {
        const next = { ...prevMap } as Record<string, Set<string>>;
        const set = new Set(next[sid] ?? []);
        set.add(pick.ItemID);
        next[sid] = set; return next;
      });
      if ((pick as any).MutuallyExclusiveGroup) setUsedMutExGroups((prev) => new Set(prev).add((pick as any).MutuallyExclusiveGroup));
      if (nextIdx != null) setSessionStepIndex(nextIdx);
      return true;
    };

    if (sessionPlanSchemas && sessionPlanSchemas.length > 0) {
      const nextIdx = sessionStepIndex + 1;
      if (nextIdx < sessionPlanSchemas.length) {
        const targetSchema = sessionPlanSchemas[nextIdx];
        if (selectAndSet(targetSchema, nextIdx)) return;
        // Fallback: try other allowed schemas if target lacks available items
        for (const sid of [AEG, BDO, SEI]) {
          if (sid === targetSchema) continue;
          if (selectAndSet(sid, nextIdx)) return;
        }
        // Nothing available -> end selection early
        setSelectedItem(null);
        return;
      }
    }

    // Legacy fallback: rotate across schemas
    if (schemaOrder.length === 0) { setSelectedItem(null); return; }
    const hasUnused = (sid: string) => computePool(sid).length > 0;
    const anyLeft = schemaOrder.some(hasUnused);
    if (!anyLeft) { setSelectedItem(null); return; }
    let idx = schemaIndex; let guard = 0;
    while (guard < schemaOrder.length && !hasUnused(schemaOrder[idx])) { idx = (idx + 1) % schemaOrder.length; guard++; }
    if (!hasUnused(schemaOrder[idx])) { setSelectedItem(null); return; }
    const sid = schemaOrder[idx];
    if (!selectAndSet(sid, null)) { setSelectedItem(null); return; }
    setSchemaIndex((v) => (idx + 1) % schemaOrder.length);
  }, [sessionPlanSchemas, sessionStepIndex, itemsBySchema, usedItemsBySchema, seenKernelIds, usedMutExGroups, schemaOrder, schemaIndex]);

  const logEvent = useCallback(async (type: string, payload: Record<string, any>, specificSessionId?: string) => {
    const sid = specificSessionId || sessionId;
    if (!sid) return;
    const entry = { ts: new Date().toISOString(), session_id: sid, user_tag: userTag || null, type, ...payload };
    try { await fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }); } catch {}
  }, [sessionId, userTag]);

  const updateUserId = useCallback(async (newUserId: string) => {
    const trimmedId = newUserId.trim();
    if (!sessionId || trimmedId === userTag) return;
    setUserTag(trimmedId);
    if (isSessionLive) {
      try { await apiPatchUpdateSession(sessionId, trimmedId); } catch (e) {
        setUserTag(userTag); setUserIdInput(userTag); alert('Error updating User ID.');
      }
    }
  }, [sessionId, userTag, isSessionLive]);

  const initializeSession = useCallback(() => {
    setSessionInitialized(false);
    const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : String(Date.now());
    setSessionId(id);
    setHistory([]);
    setLatestMeasurement(null);
    setDebugLog([]);
    setAwaitingProbe(null);
    setAwaitingTransition(null);
    setInput('');
    setProbeInput('');
    setIsSessionLive(false);
    const currentUserTag = userIdInput.trim() === '' ? null : userIdInput.trim();
    setUserTag(currentUserTag || '');
    setTheta(defaultTheta());
    setSessionInitialized(true);
    resetTransitionPhrases();
    // Reset selection policy state
    setSchemaIndex(0);
    setUsedItemsBySchema({});
    setUsedMutExGroups(new Set());
    // Build a new session plan for the next session
    const AEG = 'AlternativeExplanationGeneration';
    const BDO = 'BiasDirectionOpen';
    const SEI = 'SelectionEffectIdentification';
    const plan = [AEG, AEG, BDO, SEI].sort(() => Math.random() - 0.5);
    setSessionPlanSchemas(plan);
    setSessionStepIndex(0);
    // Select the first item for the new session if available
    try {
      const firstSchema = plan[0];
      const pool = (itemsBySchema[firstSchema] ?? []);
      if (pool.length > 0) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        setSelectedItem({ ItemID: pick.ItemID, SchemaID: pick.SchemaID, Stem: pick.Stem, isKernel: true });
        setSeenKernelIds([pick.ItemID]);
        setUsedItemsBySchema({ [firstSchema]: new Set([pick.ItemID]) });
        if ((pick as any).MutuallyExclusiveGroup) setUsedMutExGroups(new Set([(pick as any).MutuallyExclusiveGroup]));
      } else {
        setSelectedItem(null);
      }
    } catch {
      setSelectedItem(null);
    }
    // Clear persisted storage for a clean session start
    try { if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch {}
    setRestoredFromStorage(false);
  }, [userIdInput, itemsBySchema]);

  const endSession = useCallback(() => {
    logEvent('session_end_manual', { item_count: history.length });
    setShowSessionEndOverlay(true);
    setTimeout(() => {
      setShowSessionEndOverlay(false);
      try { if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch {}
      initializeSession();
    }, 2000);
  }, [history.length, initializeSession, logEvent]);

  const onSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || pending || !sessionId || !selectedItem) return;
    setPending(true);
    if (!isSessionLive) setIsSessionLive(true);
    try {
      const aj = await apiPostAJTurn({ sessionId, schemaId: selectedItem.SchemaID, itemId: selectedItem.ItemID, userText: input, context: null });
      if (aj.ok === false) {
        setDebugLog((lines) => [...lines, `[AJ error]: ${aj.error}`]);
      }
      setLatestMeasurement((aj as any)?.measurement ?? null);
      // try to set outgoing trace if present
      try {
        const msgs = (aj as any)?.debug?.messages ?? null;
        setOutgoingTurnTrace(formatOutgoingTraceForDisplay(msgs));
      } catch {}

      const turn = await apiPostTurn({ sessionId, schemaId: selectedItem.SchemaID, itemId: selectedItem.ItemID, ajMeasurement: (aj as any)?.measurement ?? null, userResponse: input });
      try { setCurrentDriverId((turn as any)?.unitState?.meta?.driverId ?? null); } catch {}
      setHistory(turn.transcript || []);
      const disp = getDisplayTheta((turn as any)?.theta);
      if (disp) setTheta(disp);
      setDebugLog((lines) => [...lines, ...(turn.telemetry ? [JSON.stringify(turn.telemetry)] : []), '—']);
      if (turn.completed) {
        setIsSessionLive(false);
        const isLastPlanned = (sessionStepIndex >= (sessionPlanSchemas.length - 1));
        if (isLastPlanned) {
          // End session using the same overlay animation as the button
          setAwaitingProbe(null);
          setAwaitingTransition(null);
          endSession();
        } else {
          // Show transition cue and advance after a short delay
          const phrase = nextTransitionPhrase();
          setAwaitingProbe(null);
          setAwaitingTransition(phrase);
          const prevSel = selectedItem;
          setTimeout(() => {
            setAwaitingTransition(null);
            pickNextItem(prevSel);
          }, DEFAULT_TRANSITION_DELAY_MS);
        }
      }
      const probeText = (turn as any)?.probe?.text ?? '';
      if (probeText) setAwaitingProbe({ prompt: probeText, initial_answer: input });
      else setAwaitingProbe(null);
      setInput('');
    } catch (err) {
      setDebugLog((lines) => [...lines, `[turn error]: ${(err as Error).message}`]);
    } finally {
      setPending(false);
    }
  }, [input, pending, sessionId, selectedItem, isSessionLive, pickNextItem, endSession, sessionPlanSchemas.length, sessionStepIndex]);

  const onSubmitProbe = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!awaitingProbe || !probeInput.trim() || pending || !sessionId || !selectedItem) return;
    setPending(true);
    try {
      const { prompt, initial_answer } = awaitingProbe;
      const aj2 = await apiPostAJTurn({ sessionId, schemaId: selectedItem.SchemaID, itemId: selectedItem.ItemID, userText: probeInput, context: { stimulus: selectedItem.Stem, probe_question: prompt, user_initial_answer: initial_answer } });
      if (aj2.ok === false) {
        setDebugLog((lines) => [...lines, `[AJ error 2]: ${aj2.error}`]);
      }
      setLatestMeasurement((aj2 as any)?.measurement ?? null);
      try { const msgs = (aj2 as any)?.debug?.messages ?? null; setOutgoingTurnTrace(formatOutgoingTraceForDisplay(msgs)); } catch {}
      const merged = await apiPostTurn({ sessionId, schemaId: selectedItem.SchemaID, itemId: selectedItem.ItemID, ajMeasurement: (aj2 as any)?.measurement ?? null, userResponse: initial_answer, probeResponse: probeInput });
      try { setCurrentDriverId((merged as any)?.unitState?.meta?.driverId ?? null); } catch {}
      setHistory(merged.transcript || []);
      const disp = getDisplayTheta((merged as any)?.theta);
      if (disp) setTheta(disp);
      setDebugLog((lines) => [...lines, ...(merged.telemetry ? [JSON.stringify(merged.telemetry)] : []), '—']);
      if (merged.completed) {
        setAwaitingProbe(null);
        setProbeInput('');
        const isLastPlanned = (sessionStepIndex >= (sessionPlanSchemas.length - 1));
        if (isLastPlanned) {
          setAwaitingTransition(null);
          endSession();
          setPending(false);
          return;
        } else {
          const phrase = nextTransitionPhrase();
          setAwaitingTransition(phrase);
          const prevSel = selectedItem;
          setTimeout(() => {
            setAwaitingTransition(null);
            pickNextItem(prevSel);
          }, DEFAULT_TRANSITION_DELAY_MS);
          setPending(false);
          return;
        }
      }
      const newProbeText = (merged as any)?.probe?.text ?? '';
      if (newProbeText) {
        setAwaitingProbe({ prompt: newProbeText, initial_answer });
        setProbeInput('');
      } else {
        // No new probe; treat as item completion and transition to next
        setAwaitingProbe(null);
        setProbeInput('');
        const phrase = nextTransitionPhrase();
        setAwaitingTransition(phrase);
        const prevSel = selectedItem;
        setTimeout(() => {
          setAwaitingTransition(null);
          pickNextItem(prevSel);
        }, DEFAULT_TRANSITION_DELAY_MS);
      }
    } catch (err) {
      setDebugLog((lines) => [...lines, `[turn probe error]: ${(err as Error).message}`]);
    } finally {
      setPending(false);
    }
  }, [awaitingProbe, probeInput, pending, sessionId, selectedItem, pickNextItem, sessionPlanSchemas.length, sessionStepIndex, endSession]);

  useEffect(() => { if (!restoredFromStorage) initializeSession(); }, [initializeSession, restoredFromStorage]);
  // Persist key parts of session so navigation to Admin doesn't reset it
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!sessionId || !selectedItem) return;
      const usedMap: Record<string, string[]> = {};
      for (const k of Object.keys(usedItemsBySchema)) usedMap[k] = Array.from(usedItemsBySchema[k] || []);
      const payload = {
        sessionId,
        userTag,
        selectedItem,
        sessionPlanSchemas,
        sessionStepIndex,
        usedItemsBySchema: usedMap,
        usedMutExGroups: Array.from(usedMutExGroups),
        seenKernelIds,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, [sessionId, userTag, selectedItem, sessionPlanSchemas, sessionStepIndex, usedItemsBySchema, usedMutExGroups, seenKernelIds]);

  return {
    // state
    debugLog, input, probeInput, history, awaitingProbe, awaitingTransition, theta, pending, latestMeasurement, ellipsisCount,
    bankItems, selectedItem, outgoingTurnTrace, seenKernelIds,
    isSessionLive, userIdInput, userTag, sessionId, sessionInitialized, isSidebarVisible, showSessionEndOverlay,
    driverCapabilities: currentDriverId ? capByDriverId[currentDriverId] ?? null : null,
    // progress
    progressCurrent: Math.min(sessionPlanSchemas.length > 0 ? (sessionStepIndex + 1) : 0, sessionPlanSchemas.length || 0),
    progressTotal: sessionPlanSchemas.length || 0,
    // setters
    setInput, setProbeInput, setIsSidebarVisible, setUserIdInput, setUserTag,
    // actions
    onSubmit, onSubmitProbe, updateUserId, initializeSession, endSession,
  } as const;
}

export default useAssessment;
