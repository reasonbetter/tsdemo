import type { DisplayTheta } from '@/types/kernel';

// Convert kernel theta state (vector) or legacy display object to a DisplayTheta
export function getDisplayTheta(thetaState: unknown): DisplayTheta | null {
  if (!thetaState || typeof thetaState !== 'object') return null;
  const obj: any = thetaState as any;
  if (typeof obj.mean === 'number' && typeof obj.se === 'number') return obj as DisplayTheta;
  const keys = Object.keys(obj);
  if (keys.length > 0) {
    const comp = obj[keys[0] as keyof typeof obj] as any;
    if (comp && typeof comp.mean === 'number' && typeof comp.var === 'number') {
      return { mean: comp.mean, se: Math.sqrt(comp.var) };
    }
  }
  return null;
}

// Render a measurement object in a compact display-friendly string
export function formatMeasurementForDisplay(measurement: unknown): string {
  if (measurement === null || measurement === undefined) return 'null';
  if (typeof measurement !== 'object' || Array.isArray(measurement)) {
    try { return JSON.stringify(measurement, null, 2); } catch { return String(measurement); }
  }
  try {
    return Object.entries(measurement as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n') || '(empty object)';
  } catch {
    return '(unrenderable)';
  }
}

// Prettify a turn trace messages array for display
export function formatOutgoingTraceForDisplay(messages: unknown): string {
  if (!messages) {
    return 'Debug trace not available.\nSet DEBUG_API_RESPONSES=true in .env to enable.';
  }
  if (!Array.isArray(messages)) {
    return 'Debug trace not available.\nSet DEBUG_API_RESPONSES=true in .env to enable.';
  }
  if (messages.length === 0) {
    return 'No messages in trace.';
  }
  const formatted = messages
    .map((msg: any) => `role: ${msg?.role}\n\n${msg?.content}`)
    .join('\n\n-------------------\n\n');
  let cleaned = formatted.replace(/[\[\]{}\"]/g, '');
  cleaned = cleaned.replace(/ {3,}| {2,},/g, '');
  cleaned = cleaned.replace(/^\s*,\s*$/gm, '');
  return cleaned;
}

