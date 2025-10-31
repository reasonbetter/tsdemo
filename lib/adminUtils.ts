import type { DisplayTheta, TranscriptEntry } from '@/types/kernel';
import { getDisplayTheta } from '@/lib/utils';

export const DEFAULT_DISPLAY_THETA: DisplayTheta = { mean: 0, se: Math.sqrt(1.5) };

export function sanitizeThetaState(candidate: unknown, fallback: DisplayTheta): DisplayTheta {
  if (!candidate || typeof candidate !== 'object') return fallback;
  const converted = getDisplayTheta(candidate);
  if (converted) return converted;
  const { mean, se } = candidate as Partial<DisplayTheta>;
  const safeMean = typeof mean === 'number' ? mean : fallback.mean;
  const safeSe = typeof se === 'number' ? se : fallback.se;
  return { mean: safeMean, se: safeSe };
}

export function buildDisplayTranscript(session: {
  thetaMean: number;
  thetaVar: number;
  theta?: unknown;
  transcript: TranscriptEntry[];
}) {
  const sessionThetaCandidate = (session as any).theta || { mean: session.thetaMean, se: Math.sqrt(session.thetaVar) };
  const sessionFallback = sanitizeThetaState(sessionThetaCandidate, DEFAULT_DISPLAY_THETA);

  return session.transcript.reduce(
    (entries: Array<{ entry: TranscriptEntry; displayThetaBefore: DisplayTheta; finalThetaState: DisplayTheta }>, entry, index, source) => {
      const previousFinalTheta = entries.length ? entries[entries.length - 1].finalThetaState : DEFAULT_DISPLAY_THETA;
      const displayThetaBefore = sanitizeThetaState(entry.theta_state_before, previousFinalTheta);
      const nextThetaCandidate = index < source.length - 1 ? (source as any)[index + 1].theta_state_before : sessionFallback;
      const finalThetaState = sanitizeThetaState(nextThetaCandidate, sessionFallback);
      entries.push({ entry, displayThetaBefore, finalThetaState });
      return entries;
    },
    [] as Array<{ entry: TranscriptEntry; displayThetaBefore: DisplayTheta; finalThetaState: DisplayTheta }>
  );
}

