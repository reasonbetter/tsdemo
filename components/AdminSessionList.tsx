import React from 'react';
import AdminSessionCard from '@/components/AdminSessionCard';
import type { TranscriptEntry, DisplayTheta } from '@/types/kernel';
import type { SessionWithTranscript as AdminSession } from 'hooks/useAdminData';

export default function AdminSessionList({
  items,
  hasMore,
  loading,
  onLoadMore,
}: {
  items: Array<{ session: AdminSession; entries: Array<{ entry: TranscriptEntry; displayThetaBefore: DisplayTheta; finalThetaState: DisplayTheta }> }>;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section className="space-y-2">
      {items.map(({ session, entries }) => (
        <AdminSessionCard key={session.id} session={session} entries={entries} />
      ))}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-4 animate-pulse">
              <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
              <div className="h-3 w-full bg-gray-100 rounded mb-2" />
              <div className="h-3 w-5/6 bg-gray-100 rounded mb-2" />
              <div className="h-3 w-4/6 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-primary-hover disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More Sessions'}
          </button>
        </div>
      ) : (
        items.length > 0 && (
          <div className="mt-6 text-center text-sm text-muted-foreground">No more results.</div>
        )
      )}
    </section>
  );
}
