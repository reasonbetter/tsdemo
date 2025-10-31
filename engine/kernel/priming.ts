import type { AJInitPayload, ItemEnvelope, SchemaEnvelope, SessionSnapshot, SkillDriver } from "@/types/kernel";
import { resolveDriver } from "@/engine/registry";

/** Optional transport to POST payload to /api/aj_init; if absent we prime optimistically. */
export type AJPrimingTransport = (args: {
  sessionId: string; driver: SkillDriver; schema: SchemaEnvelope; item?: ItemEnvelope;
  payload: AJInitPayload; guidanceVersion: string;
}) => Promise<boolean | void>;

export interface PrimingOptions {
  transport?: AJPrimingTransport | null;
  persist?: (sessionId: string, ajPriming: SessionSnapshot["ajPriming"]) => Promise<void>;
  log?: (lvl: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
}

function isPrimed(session: SessionSnapshot, driverId: string, guidanceVersion: string): boolean {
  const e = session.ajPriming?.[driverId];
  return !!e && e.guidanceVersion === guidanceVersion && e.primed === true;
}

async function markPrimed(session: SessionSnapshot, driverId: string, guidanceVersion: string, persist?: PrimingOptions["persist"], log?: PrimingOptions["log"]) {
  session.ajPriming = session.ajPriming ?? {};
  session.ajPriming[driverId] = { guidanceVersion, primed: true };
  if (persist) await persist(session.id, session.ajPriming);
  log?.("debug", "AJ primed", { driverId, guidanceVersion, sessionId: session.id });
}

export async function ensureAJPrimed(
  session: SessionSnapshot,
  schema: SchemaEnvelope,
  item?: ItemEnvelope,
  opts?: PrimingOptions
): Promise<{ primed: boolean; reason: "cache_hit" | "initialized" | "transport_skipped" | "transport_failed"; guidanceVersion: string; payload: AJInitPayload }> {
  const log = opts?.log ?? (() => {});
  const driver = resolveDriver(schema.Engine ?? {});
  const payload = driver.buildAJInit(schema, item);
  const guidanceVersion = schema.GuidanceVersion;

  if (isPrimed(session, driver.id, guidanceVersion)) {
    log("debug", "Priming cache hit", { driverId: driver.id, guidanceVersion });
    return { primed: true, reason: "cache_hit", guidanceVersion, payload };
  }

  if (!opts?.transport) {
    await markPrimed(session, driver.id, guidanceVersion, opts?.persist, log);
    return { primed: true, reason: "transport_skipped", guidanceVersion, payload };
  }

  try {
    const ok = await opts.transport({ sessionId: session.id, driver, schema, item, payload, guidanceVersion });
    if (ok === false) return { primed: false, reason: "transport_failed", guidanceVersion, payload };
    await markPrimed(session, driver.id, guidanceVersion, opts?.persist, log);
    return { primed: true, reason: "initialized", guidanceVersion, payload };
  } catch {
    return { primed: false, reason: "transport_failed", guidanceVersion, payload };
  }
}
