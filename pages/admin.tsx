import { useCallback, useEffect, useMemo, useState } from "react";
import useAdminData, { SessionWithTranscript as AdminSession } from "hooks/useAdminData";
import { Session } from "@prisma/client";
import { TranscriptEntry, ThetaState, DisplayTheta } from "@/types/kernel";
import { getDisplayTheta as getDisplayThetaUtil } from "@/lib/utils";
import { buildDisplayTranscript, sanitizeThetaState, DEFAULT_DISPLAY_THETA } from "@/lib/adminUtils";
import dynamic from "next/dynamic";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import AdminSessionList from "@/components/AdminSessionList";

// Dynamically import ReactMarkdown to reduce initial bundle size
const ReactMarkdown = dynamic(() => import("react-markdown"), {
  ssr: false,
  loading: () => <span className="text-muted-foreground">Loading...</span>,
});

type SessionWithTranscript = Omit<Session, "transcript"> & {
  transcript: TranscriptEntry[];
};

// Use centralized DisplayTheta type from '@/types/kernel'

type DisplayTranscriptEntry = {
  entry: TranscriptEntry;
  displayThetaBefore: DisplayTheta;
  finalThetaState: DisplayTheta;
};

// Use shared theta display helper
const getDisplayTheta = getDisplayThetaUtil;

const isTranscriptEntry = (candidate: unknown): candidate is TranscriptEntry => {
  return Boolean(
    candidate &&
      typeof candidate === "object" &&
      "text" in candidate &&
      typeof (candidate as { text?: unknown }).text === "string"
  );
};

const parseSessions = (payload: unknown): SessionWithTranscript[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeSessions = (payload as { sessions?: unknown }).sessions;
  if (!Array.isArray(maybeSessions)) {
    return [];
  }

  return maybeSessions.reduce<SessionWithTranscript[]>((acc, session) => {
    if (!session || typeof session !== "object") {
      return acc;
    }

    const { transcript: rawTranscript, ...rest } = session as Session & {
      transcript?: unknown;
    };

    if (!("id" in rest)) {
      return acc;
    }

    const transcript = Array.isArray(rawTranscript)
      ? (rawTranscript as unknown[]).filter(isTranscriptEntry)
      : [];

    acc.push({ ...(rest as Omit<Session, "transcript">), transcript });
    return acc;
  }, []);
};

const buildDisplayTranscriptLocal = (session: SessionWithTranscript): DisplayTranscriptEntry[] =>
  buildDisplayTranscript(session as any);

// Helper component for displaying Theta change
const ThetaChangeDisplay = ({ before, after }: { before?: DisplayTheta; after: DisplayTheta }) => {
  if (!before) return null;

  const change = after.mean - before.mean;
  const color = change > 0.005 ? "text-green-600" : change < -0.005 ? "text-red-600" : "text-gray-500";

  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      θ: {before.mean.toFixed(2)} → {after.mean.toFixed(2)}
    </span>
  );
};

export default function Admin() {
  const {
    sessions,
    loading,
    error,
    password,
    setPassword,
    isAuthenticated,
    authChecking,
    hasMore,
    totalCount,
    handlePasswordSubmit,
    refresh,
    downloadJSON,
    clearServer,
  } = useAdminData();

  // handled in useAdminData: handlePasswordSubmit

  // handled in useAdminData: refresh

  // handled in useAdminData: downloadJSON

  // handled in useAdminData: clearServer

  // handled in useAdminData: auth check + refresh lifecycle

  const displaySessions = useMemo(() =>
    sessions.map((session: AdminSession) => ({ session, entries: buildDisplayTranscriptLocal(session as any) })),
  [sessions]);

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Checking authentication...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const AdminAuthForm = require('@/components/AdminAuthForm').default;
    return <AdminAuthForm password={password} setPassword={setPassword} loading={loading} onSubmit={handlePasswordSubmit} />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-3xl font-bold leading-tight tracking-tight text-foreground">Session Logs</h1>
      <p className="mb-6 text-muted-foreground">Review full session transcripts stored in the database.</p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-center gap-4">
        <a className="mr-4 text-sm font-medium text-primary transition hover:text-primary-hover" href="/">
          ← Back to Demo
        </a>
        <button
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-primary-hover disabled:opacity-50"
          onClick={() => refresh(false)}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition duration-150 hover:bg-gray-50"
          onClick={() => downloadJSON(sessions, "server-sessions")}
        >
          Download Sessions JSON
        </button>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between px-2 mb-4">
          <h3 className="text-xl font-semibold">
            Session Transcripts
          </h3>
          <span className="text-sm text-muted-foreground">
            Showing {sessions.length} of {totalCount} sessions
          </span>
        </div>
        {sessions.length === 0 && !loading && (
          <p className="text-muted-foreground px-2">No sessions found in the database.</p>
        )}
        <AdminSessionList
          items={displaySessions as any}
          hasMore={hasMore}
          loading={loading}
          onLoadMore={() => refresh(true, sessions.length)}
        />
      </section>

      <div className="mt-12 border-t border-border pt-6">
        <button
          type="button"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition duration-150 hover:bg-red-100"
          onClick={clearServer}
        >
          Clear Database (All Data)
        </button>
      </div>
    </div>
  );
}
