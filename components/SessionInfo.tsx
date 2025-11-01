import React from 'react';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { getDisplayTheta, formatMeasurementForDisplay } from '@/lib/utils';
import type { DisplayTheta } from '@/types/kernel';

type SelectedItem = { ItemID: string; SchemaID: string; Stem: string; isKernel?: boolean } | null;

export default function SessionInfo({
  theta,
  selectedItem,
  latestMeasurement,
  onReset,
  capabilities,
  bare,
  onEndSession,
  hideAdminLink,
}: {
  theta: DisplayTheta;
  selectedItem: SelectedItem;
  latestMeasurement: any | null;
  onReset: () => void;
  capabilities?: { usesProbes?: boolean; continuousScore?: boolean } | null;
  bare?: boolean;
  onEndSession?: () => void;
  hideAdminLink?: boolean;
}) {
  const content = (
    <>
      <div className="flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground bg-background border border-border rounded-full">
          <strong>θ</strong> {Number(getDisplayTheta(theta)?.mean ?? 0).toFixed(2)}
        </span>
        <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground bg-background border border-border rounded-full">
          <strong>SE</strong> {Number(getDisplayTheta(theta)?.se ?? Math.sqrt(1.5)).toFixed(2)}
        </span>
        {capabilities?.usesProbes && (
          <span className="inline-flex items-center gap-2 px-2 py-0.5 text-xs text-blue-700 bg-blue-100 border border-blue-200 rounded-full">Probes</span>
        )}
        {capabilities?.continuousScore && (
          <span className="inline-flex items-center gap-2 px-2 py-0.5 text-xs text-purple-700 bg-purple-100 border border-purple-200 rounded-full">Continuous</span>
        )}
      </div>
      <div className="mt-3 text-xs text-muted-foreground font-mono">
        {selectedItem?.ItemID ? (
          <>
            <p>Item: {selectedItem.ItemID}</p>
            <p className="mt-1">Schema: {selectedItem.SchemaID}</p>
          </>
        ) : null}
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        {latestMeasurement ? (
          <div className="bg-white p-3 rounded-md text-sm font-mono whitespace-pre-wrap">
            {formatMeasurementForDisplay(latestMeasurement)}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">No measurement yet.</div>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-border flex items-center gap-4 flex-wrap">
        <button type="button" className="px-4 py-1 text-sm font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150" onClick={onReset}>
          Reset Session
        </button>
        {onEndSession && (
          <button type="button" className="px-4 py-1 text-sm font-semibold rounded-lg bg-card text-foreground border border-input-border hover:bg-gray-50 transition duration-150" onClick={onEndSession}>
            End Session
          </button>
        )}
        {!hideAdminLink && (
          <a className="px-4 py-1 text-sm font-semibold rounded-lg text-primary border border-primary-border hover:bg-primary-light transition duration-150" href="/admin" title="Admin log">
            View Admin Logs
          </a>
        )}
      </div>
    </>
  );

  if (bare) return <>{content}</>;

  return (
    <CollapsibleSection title="Session Info" titleSize="sm" className="bg-card shadow-sm" defaultOpen={true} isCollapsible={false}>
      {content}
    </CollapsibleSection>
  );
}
