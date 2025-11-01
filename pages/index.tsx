import { useEffect, useMemo, useRef } from "react";
// import types and utils as needed
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import TranscriptPanel from '@/components/TranscriptPanel';
import SessionInfo from '@/components/SessionInfo';
import DebugSidebar from '@/components/DebugSidebar';
import PromptForm from '@/components/PromptForm';
import ProbeForm from '@/components/ProbeForm';
import useAssessment from 'hooks/useAssessment';
import TransitionMessage from '@/components/TransitionMessage';
import SessionProgress from '@/components/SessionProgress';
import { CollapsibleSection } from '@/components/CollapsibleSection';


// Assessment state and actions are provided by useAssessment

// Helper component for rendering markdown prompts professionally
const Prose = ({ children, size = 'lg' }: { children: string, size?: 'sm' | 'lg' }) => (
    <div className={`${size === 'lg' ? 'text-base sm:text-lg leading-relaxed' : 'text-sm sm:text-base leading-normal'} tracking-[-0.01em] text-foreground mb-4 sm:mb-8 [&>p]:mb-4 [&>ul]:list-disc [&>ul]:pl-5 [&>li]:mb-2`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );

// Use centralized DisplayTheta type from '@/types/kernel'

export default function Home() {
  const {
    debugLog, input, probeInput, history, awaitingProbe, awaitingTransition, theta, pending, latestMeasurement, ellipsisCount,
    bankItems, selectedItem, outgoingTurnTrace,
    isSessionLive, userIdInput, userTag, sessionId, sessionInitialized, isSidebarVisible, showSessionEndOverlay,
    progressCurrent, progressTotal,
    setInput, setProbeInput, setIsSidebarVisible, setUserIdInput, setUserTag,
    onSubmit, onSubmitProbe, updateUserId, initializeSession, endSession, driverCapabilities,
  } = useAssessment();

  // (helpers removed: unused in this component)

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const probeInputRef = useRef<HTMLTextAreaElement>(null);

  // Effect to focus the correct input field when a probe is requested
  useEffect(() => {
    if (awaitingProbe) {
      probeInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [awaitingProbe]);



  // Compute the prompt text to display (kernel first)
  const promptText = useMemo(() => {
    return selectedItem?.Stem || "";
  }, [selectedItem]);

  // --- Session Management ---

    // updateUserId handled within useAssessment


    // initializeSession and endSession handled within useAssessment

  // --- Loading/Error States ---
   if (!sessionInitialized) {
    return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-muted-foreground">Initializing session...</div>;
  }

  if (!sessionId) {
    return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-red-600">Session initialization failed. Please try refreshing the page.</div>;
  }

  if (!selectedItem) {
     if (history.length > 0 && !pending) {
       return (
         <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
             <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground mb-6">Assessment Complete</h1>
             <div className="bg-card shadow-sm border border-border rounded-xl p-6 mb-6">
                 <p className="text-lg mb-4">Thank you for participating. Your session has ended.</p>
                 <p className="text-lg font-semibold">Final Theta Estimate: {Number(theta?.mean ?? 0).toFixed(2)} (SE: {Number(theta?.se ?? Math.sqrt(1.5)).toFixed(2)})</p>
             </div>
             <div className="flex gap-4">
                 <button className="px-6 py-2 text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover transition duration-150" onClick={initializeSession}>Start New Session</button>
                 <a className="px-6 py-2 text-base font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150 inline-flex items-center" href="/admin">View Admin Logs</a>
             </div>
         </div>
       );
     }
     // While items are loading or if none are selected yet
     return <div className="max-w-6xl mx-auto py-12 px-4 sm:px-6 lg:px-8 text-muted-foreground">Loading...</div>;
  }


  // --- render ---
  return (
    <div className="min-h-screen flex items-center justify-center relative">
      {showSessionEndOverlay && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-xl shadow-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-2">Session Ended and Logged</h2>
            <p className="text-muted-foreground">Starting new session...</p>
          </div>
        </div>
      )}
      <div className="w-full max-w-6xl px-4 sm:px-6 lg:px-8">

       <div className={`transition-all duration-300 ${!isSidebarVisible ? 'max-w-4xl mx-auto' : ''}`}>
         <header className="relative flex flex-col -gap-2 sm:flex-row sm:justify-between sm:items-center mb-4 sm:mb-2 lg:-mb-2">
              <div className="flex items-center -ml-4 sm:ml-0 gap-0 sm:gap-0">
                  {/* Mobile logo */}
                  <Image src="/AIowl5.PNG" alt="Wise Wireframe Logo" width={150} height={150} className="block sm:hidden -ml-6 mr-0" priority />
                  {/* Desktop logo */}
                  <Image src="/AIowl5.PNG" alt="Wise Wireframe Logo" width={220} height={220} className="hidden sm:block -ml-14 -mr-14" priority />
                  <div className="-ml-8 sm:ml-0">
                    <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight text-gray-700">Reasoning Interviewer</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">[Causal Inference Demo]</p>
                  </div>
              </div>
              <div className="flex flex-col items-end gap-2 ml-3 sm:ml-0 w-full sm:w-auto">
                  {/* Toggle icon above, on desktop */}
                  {/* Icon moved above main card */}

                  {/* (User ID moved into main card) */}
                  
              </div>
         </header>
       </div>


       <div className={`grid grid-cols-1 ${isSidebarVisible ? 'lg:grid-cols-3' : ''} gap-8`}>

            <main className={`transition-all duration-300 ${isSidebarVisible ? 'lg:col-span-2' : 'max-w-4xl mx-auto w-full'}`}>
                {/* Expand/Collapse icon above main box (desktop) */}
                <div className="hidden sm:flex justify-end mb-1"></div>

                <section className="bg-card shadow-lg border border-border rounded-xl px-6 py-5 sm:px-10 sm:py-8 mb-12 animate-fadeIn">
                    <Prose>{promptText || ""}</Prose>

                    {awaitingTransition && (
                      <TransitionMessage message={awaitingTransition} />
                    )}

                    {!awaitingTransition && !awaitingProbe && promptText && (
                      <PromptForm
                        inputRef={inputRef}
                        value={input}
                        onChange={setInput}
                        pending={pending}
                        ellipsisCount={ellipsisCount}
                        onSubmit={onSubmit}
                        onEndSession={endSession}
                        userIdInput={userIdInput}
                        setUserIdInput={setUserIdInput}
                        updateUserId={updateUserId}
                      />
                    )}

                    {!awaitingTransition && awaitingProbe && (
                      <ProbeForm
                        prompt={awaitingProbe.prompt}
                        probeInputRef={probeInputRef}
                        value={probeInput}
                        onChange={setProbeInput}
                        pending={pending}
                        ellipsisCount={ellipsisCount}
                        onSubmit={onSubmitProbe}
                        onEndSession={endSession}
                        userIdInput={userIdInput}
                        setUserIdInput={setUserIdInput}
                        updateUserId={updateUserId}
                      />
                    )}
                </section>

                {selectedItem && progressTotal > 0 && (
                  <div className="mt-2 mb-8">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Progress (narrower on desktop) */}
                      <div className="w-full sm:w-2/5">
                        <SessionProgress current={progressCurrent} total={progressTotal} />
                      </div>
                      {/* Right-aligned controls on desktop (>=1024px): User ID + End Session + Details */}
                      <div className="hidden lg:flex items-center gap-3 ml-auto">
                        <label className="text-sm font-semibold text-primary">User ID:</label>
                        <input
                          className={`w-36 px-2 py-1 text-sm border rounded-lg transition duration-150 ${userIdInput === userTag && userTag !== "" ? 'bg-gray-100 text-muted-foreground' : 'border-input-border focus:ring-primary focus:border-primary'}`}
                          value={userIdInput}
                          onChange={(e) => setUserIdInput(e.target.value)}
                          onBlur={(e) => updateUserId(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              updateUserId((e.target as HTMLInputElement).value);
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          placeholder="Optional"
                      readOnly={userIdInput === userTag && userTag !== ""}
                        />
                        <button type="button" className="inline-flex items-center h-[30px] px-4 text-sm font-semibold rounded-lg bg-card text-foreground border border-input-border hover:bg-gray-50 transition duration-150 whitespace-nowrap" onClick={endSession}>
                          End Session
                        </button>
                        <button
                          type="button"
                          className={`inline-flex items-center gap-2 h-[30px] ${isSidebarVisible ? 'px-2' : 'px-3'} text-sm font-semibold text-foreground bg-card border border-input-border rounded-lg hover:bg-gray-50 transition duration-150`}
                          onClick={() => setIsSidebarVisible(!isSidebarVisible)}
                          aria-label={isSidebarVisible ? 'Hide details' : 'Show details'}
                          title={isSidebarVisible ? 'Hide details' : 'Show details'}
                        >
                          {isSidebarVisible ? (
                            // Only left chevron when open (collapse)
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              width="18"
                              height="18"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              className="text-muted-foreground"
                            >
                              <polyline points="15 18 9 12 15 6" />
                            </svg>
                          ) : (
                            // "Details" + right chevron when closed (expand)
                            <>
                              <span>Details</span>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                className="text-muted-foreground"
                              >
                                <polyline points="9 6 15 12 9 18" />
                              </svg>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="sm:hidden flex items-center gap-3 mt-4">
                      <label className="text-sm font-semibold text-primary">User ID:</label>
                      <input
                        className={`w-28 px-2 py-1 text-sm border rounded-lg transition duration-150 ${userIdInput === userTag && userTag !== "" ? 'bg-gray-100 text-muted-foreground' : 'border-input-border focus:ring-primary focus:border-primary'}`}
                        value={userIdInput}
                        onChange={(e) => setUserIdInput(e.target.value)}
                        onBlur={(e) => updateUserId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            updateUserId((e.target as HTMLInputElement).value);
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="Optional"
                      />
                      <button type="button" className="ml-auto px-4 py-1.5 text-sm font-semibold rounded-lg bg-card text-foreground border border-input-border hover:bg-gray-50 transition duration-150 whitespace-nowrap" onClick={endSession}>
                        End Session
                      </button>
                    </div>
                    <div className="lg:hidden mt-6">
                      <CollapsibleSection title="Session Info" className="bg-card shadow-sm" defaultOpen={false} titleSize="xs">
                        <div className="space-y-6">
                          <SessionInfo bare theta={theta} selectedItem={selectedItem} latestMeasurement={latestMeasurement} onReset={initializeSession} capabilities={driverCapabilities} />
                          <DebugSidebar outgoingTurnTrace={outgoingTurnTrace} debugLog={debugLog} titleSize="xs" />
                        </div>
                      </CollapsibleSection>
                    </div>
                    
                  </div>
                )}

                {history.length > 0 && (
                  <TranscriptPanel history={history} currentTheta={theta} capabilities={driverCapabilities} />
                )}

            </main>

            <aside className={`hidden ${isSidebarVisible ? 'lg:block' : 'lg:hidden'} lg:col-span-1 transition-all duration-300 ease-in-out`}>
                <div className="space-y-6">
                    <SessionInfo theta={theta} selectedItem={selectedItem} latestMeasurement={latestMeasurement} onReset={initializeSession} capabilities={driverCapabilities} />

                    <DebugSidebar outgoingTurnTrace={outgoingTurnTrace} debugLog={debugLog} />
                </div>
            </aside>
       </div>
      </div>
    </div>
  );
}
