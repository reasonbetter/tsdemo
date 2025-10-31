// engine/session/store.ts
import type { SessionSnapshot, ThetaState, UnitStateEnvelope, TranscriptEntry } from "@/types/kernel";

/** SessionStore abstraction; you can add a Prisma backend later */
export interface SessionStore {
  get(id: string): Promise<SessionSnapshot | null>;
  put(s: SessionSnapshot): Promise<void>;
  create(id?: string): Promise<SessionSnapshot>;
}

function blankTheta(): ThetaState {
  return {};
}
function newSession(id: string): SessionSnapshot {
  return {
    id,
    theta: blankTheta(),
    currentItemId: null,
    ajPriming: {},
    unit: null,
    transcript: [],
  };
}

// -------- In-memory backend (dev/local) --------
class MemoryStore implements SessionStore {
  private map: Map<string, SessionSnapshot>;
  constructor() {
    // Persist across hot reloads
    const g = globalThis as any;
    if (!g.__MEM_SESSIONS__) g.__MEM_SESSIONS__ = new Map<string, SessionSnapshot>();
    this.map = g.__MEM_SESSIONS__;
  }
  async get(id: string) { return this.map.get(id) ?? null; }
  async put(s: SessionSnapshot) { this.map.set(s.id, s); }
  async create(id?: string) {
    const i = id ?? `sess_${Math.random().toString(36).slice(2)}`;
    const s = newSession(i);
    this.map.set(i, s);
    return s;
  }
}

// -------- Optional Prisma backend (prod) --------
class PrismaStore implements SessionStore {
  private prisma: any;
  constructor(prismaClient: any) { this.prisma = prismaClient; }

  async get(id: string): Promise<SessionSnapshot | null> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row) return null;
    const theta = (row.theta as ThetaState) ?? blankTheta();
    const ajPriming = (row.ajPriming as Record<string, { guidanceVersion: string; primed: boolean }>) ?? {};
    const unit = (row.unitSnapshot as { driverId: string; state: UnitStateEnvelope; completed: boolean }) ?? null;
    const transcript = (row.transcript as TranscriptEntry[]) ?? [];
    return {
      id: row.id,
      theta,
      currentItemId: unit?.state?.meta?.itemId ?? null,
      ajPriming,
      unit,
      transcript,
    };
  }

  async put(s: SessionSnapshot): Promise<void> {
    await this.prisma.session.upsert({
      where: { id: s.id },
      update: {
        theta: s.theta ?? blankTheta(),
        ajPriming: s.ajPriming ?? {},
        unitSnapshot: s.unit ?? null,
        transcript: s.transcript ?? [],
      },
      create: {
        id: s.id,
        userTag: null,
        theta: s.theta ?? blankTheta(),
        ajPriming: s.ajPriming ?? {},
        unitSnapshot: s.unit ?? null,
        askedItemIds: [],
        coverageCounts: {},
        transcript: s.transcript ?? [],
      },
    });
  }

  async create(id?: string): Promise<SessionSnapshot> {
    const i = id ?? `sess_${Math.random().toString(36).slice(2)}`;
    const s = newSession(i);
    await this.put(s);
    return s;
  }
}

export function getSessionStore(): SessionStore {
  const useMemory = process.env.SESSION_BACKEND === "memory" || !process.env.DATABASE_URL;
  if (useMemory) return new MemoryStore();

  // Try Prisma if available
  try {
    // lazy require to avoid bundling if unused in dev
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    return new PrismaStore(prisma);
  } catch {
    // Fallback to memory if Prisma not installed
    return new MemoryStore();
  }
}
