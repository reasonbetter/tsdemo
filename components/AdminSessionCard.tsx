import React from 'react';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import ReactMarkdown from 'react-markdown';
import type { TranscriptEntry, DisplayTheta } from '@/types/kernel';
import type { SessionWithTranscript as AdminSession } from 'hooks/useAdminData';

const ThetaChangeDisplay = ({ before, after }: { before?: DisplayTheta; after: DisplayTheta }) => {
  if (!before) return null;
  const change = after.mean - before.mean;
  const color = change > 0.005 ? 'text-green-600' : change < -0.005 ? 'text-red-600' : 'text-gray-500';
  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      θ: {before.mean.toFixed(2)} → {after.mean.toFixed(2)}
    </span>
  );
};

export default function AdminSessionCard({
  session,
  entries,
}: {
  session: AdminSession;
  entries: Array<{ entry: TranscriptEntry; displayThetaBefore: DisplayTheta; finalThetaState: DisplayTheta }>;
}) {
  const title = `${new Date((session as any).updatedAt ?? Date.now()).toLocaleString()}${session.userTag ? ` (User: ${session.userTag})` : ''}`;
  return (
    <CollapsibleSection key={session.id} title={title} className="bg-card shadow-sm" titleSize="xs">
      <div className="space-y-4 text-sm">
        {entries.map(({ entry, displayThetaBefore, finalThetaState }, idx) => (
          <div key={idx} className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-xs text-muted-foreground">ITEM: {entry.item_id}</p>
              {entry.label === 'kernel' ? (
                <ThetaChangeDisplay before={displayThetaBefore} after={finalThetaState} />
              ) : (
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    entry.label === 'Correct'
                      ? 'bg-green-100 text-green-800'
                      : ['Incomplete', 'Flawed', 'Ambiguous'].includes(entry.label as any)
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

            <div className="mt-2 rounded-md border bg-white p-2">
              <p>
                <strong>Answer:</strong> <span className="italic">{entry.answer}</span>
              </p>
            </div>

            {entry.exchanges && entry.exchanges.length > 0 ? (
              <div className="mt-2 space-y-2">
                {entry.exchanges.map((exchange, exIdx) => (
                  <div key={exIdx} className="rounded-md border border-primary-border bg-primary-light p-2 text-primary-text">
                    <p className="font-semibold">
                      Probe {exIdx + 1}: <span className="italic">{exchange.probe_text}</span>
                    </p>
                    {exchange.probe_answer && (
                      <p className="mt-2">
                        <strong>Follow-up:</strong> <span className="italic">{exchange.probe_answer}</span>
                      </p>
                    )}
                    {exchange.label && exchange.label !== 'None' && (
                      <p className="mt-1 text-xs">Label: {exchange.label}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {!entry.exchanges && entry.probe_answer ? (
              <div className="mt-2 rounded-md border border-primary-border bg-primary-light p-2 text-primary-text">
                <p className="font-semibold">
                  Probe: <span className="italic">{(entry as any).probe_text}</span>
                </p>
                {(entry as any).probe_rationale && (
                  <p className="mt-1 text-xs">Rationale: {(entry as any).probe_rationale}</p>
                )}
                <p className="mt-2">
                  <strong>Follow-up:</strong> <span className="italic">{entry.probe_answer}</span>
                </p>
              </div>
            ) : null}

            {entry.final_score !== undefined && (
              <div className="mt-2 rounded-md border bg-gray-100 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-800">Final Assessment</p>
                  <ThetaChangeDisplay before={displayThetaBefore} after={finalThetaState} />
                </div>
                <p className="text-sm">
                  <strong>Score:</strong> {Number(entry.final_score).toFixed(2)}
                </p>
                {(entry as any).final_rationale && (
                  <p className="text-sm italic text-gray-600">Rationale: {(entry as any).final_rationale}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

