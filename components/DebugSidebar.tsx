import React from 'react';
import { CollapsibleSection } from '@/components/CollapsibleSection';

export default function DebugSidebar({
  outgoingTurnTrace,
  debugLog,
}: {
  outgoingTurnTrace: string;
  debugLog: string[];
}) {
  return (
    <>
      <CollapsibleSection title="Outgoing Trace" titleSize="sm" className="bg-card shadow-sm">
        <div className="font-mono text-xs bg-gray-800 text-gray-200 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-60 shadow-inner">
          {outgoingTurnTrace}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="AJ Debug" titleSize="sm" className="bg-card shadow-sm">
        <div className="font-mono text-xs bg-gray-900 text-gray-400 rounded-lg p-4 whitespace-pre-wrap overflow-auto max-h-80 shadow-inner">
          {debugLog.length === 0 ? 'Debug log is empty.' : debugLog.join('\n')}
        </div>
      </CollapsibleSection>
    </>
  );
}

