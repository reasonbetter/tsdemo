import React from 'react';
import { CollapsibleSection } from '@/components/CollapsibleSection';

export default function DebugSidebar({
  outgoingTurnTrace,
  debugLog,
  titleSize = 'sm',
}: {
  outgoingTurnTrace: string;
  debugLog: string[];
  titleSize?: 'xs' | 'sm' | 'lg';
}) {
  // Parse the latest debug entry to extract AJ raw and DO raw data
  const parseLatestDebugEntry = () => {
    if (debugLog.length === 0) return { ajRaw: null, doRaw: null };

    // Find the most recent non-separator entry
    const entries = debugLog.filter(entry => entry !== '—');
    if (entries.length === 0) return { ajRaw: null, doRaw: null };

    const latestEntry = entries[entries.length - 1];
    try {
      const parsed = JSON.parse(latestEntry);

      // Extract DO raw data (session/driver state)
      const doRaw = {
        attempts: parsed.attempts,
        consecutive_unproductive: parsed.consecutive_unproductive,
      };

      // Extract AJ raw data (everything else from telemetry, excluding DO fields)
      const { attempts, consecutive_unproductive, ability_key, error_code,
              aj_probe_truncated, aj_probe_reason, ...ajRaw } = parsed;

      return { ajRaw, doRaw };
    } catch {
      return { ajRaw: null, doRaw: null };
    }
  };

  const { ajRaw, doRaw } = parseLatestDebugEntry();

  return (
    <>
      <CollapsibleSection title="Outgoing Trace" titleSize={titleSize} className="bg-card shadow-sm">
        <div className="font-mono text-xs bg-gray-800 text-gray-200 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-60 shadow-inner">
          {outgoingTurnTrace}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="AJ Debug" titleSize={titleSize} className="bg-card shadow-sm">
        <div className="font-mono text-xs bg-gray-900 text-gray-400 rounded-lg p-4 space-y-3 max-h-80 overflow-auto shadow-inner">
          <div>
            <div className="text-gray-300 font-semibold mb-1">AJ raw:</div>
            <div className="break-words whitespace-pre-wrap">
              {ajRaw ? JSON.stringify(ajRaw, null, 2) : 'No AJ data yet.'}
            </div>
          </div>
          <div>
            <div className="text-gray-300 font-semibold mb-1">DO raw:</div>
            <div className="break-words whitespace-pre-wrap">
              {doRaw ? JSON.stringify(doRaw, null, 2) : 'No DO data yet.'}
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
