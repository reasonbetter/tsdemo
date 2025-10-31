import React from 'react';
import ReactMarkdown from 'react-markdown';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { getDisplayTheta } from '@/lib/utils';
import type { TranscriptEntry, DisplayTheta } from '@/types/kernel';

const ThetaChangeDisplay = ({ before, after, colorOverride }: { before?: DisplayTheta | null; after?: DisplayTheta | null; colorOverride?: string }) => {
  if (!before || !after) return null;
  const change = after.mean - before.mean;
  const autoColor = change > 0.005 ? 'text-green-600' : change < -0.005 ? 'text-red-600' : 'text-gray-500';
  const color = colorOverride || autoColor;
  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      θ: {before.mean.toFixed(2)} → {after.mean.toFixed(2)}
    </span>
  );
};

export function TranscriptPanel({ history, currentTheta, capabilities }: { history: TranscriptEntry[]; currentTheta: DisplayTheta; capabilities?: { usesProbes?: boolean; continuousScore?: boolean } | null }) {
  if (!history || history.length === 0) return null;
  return (
    <CollapsibleSection title="Transcript History" className="bg-card shadow-sm">
      {(capabilities?.usesProbes || capabilities?.continuousScore) && (
        <div className="px-3 pt-3 text-xs text-muted-foreground flex gap-2">
          {capabilities?.usesProbes && <span className="inline-flex items-center gap-2 px-2 py-0.5 text-xs text-blue-700 bg-blue-100 border border-blue-200 rounded-full">Probes</span>}
          {capabilities?.continuousScore && <span className="inline-flex items-center gap-2 px-2 py-0.5 text-xs text-purple-700 bg-purple-100 border border-purple-200 rounded-full">Continuous</span>}
        </div>
      )}
      <div className="space-y-4 text-sm">
        {history.map((entry, idx) => {
          const before = getDisplayTheta(entry.theta_state_before);
          const nextThetaState = history[idx + 1]?.theta_state_before;
          const after = getDisplayTheta(nextThetaState) || (idx === history.length - 1 ? getDisplayTheta(currentTheta) : null);
          return (
            <div key={idx} className="p-3 bg-background rounded-lg border border-border">
              <div className="flex justify-between items-center mb-2">
                <p className="font-mono text-xs text-muted-foreground">ITEM: {entry.item_id}</p>
                {entry.label === 'kernel' ? (
                  <ThetaChangeDisplay before={before} after={after} />
                ) : (
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      ['Correct', 'Good'].includes(entry.label)
                        ? 'bg-green-100 text-green-800'
                        : ['Incomplete', 'Flawed', 'Ambiguous', 'NotSpecific', 'NotClear', 'NotDistinct'].includes(entry.label)
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {entry.label}
                  </span>
                )}
              </div>
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{entry.text}</ReactMarkdown>
              </div>

              <div className="mt-2 p-2 bg-white border rounded-md">
                <p>
                  <span className="font-semibold">User:</span> <span className="italic">{entry.answer}</span>
                </p>
              </div>

              {entry.exchanges &&
                entry.exchanges.map((exchange, exIdx) => (
                  <div key={exIdx} className="mt-2 space-y-2">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{exchange.probe_text}</ReactMarkdown>
                    </div>
                    {exchange.probe_answer && (
                      <div className="mt-2 p-2 bg-white border rounded-md">
                        <p>
                          <span className="font-semibold">User:</span> <span className="italic">{exchange.probe_answer}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

export default TranscriptPanel;
