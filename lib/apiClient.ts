import { ItemsResponseSchema, TurnResponseSchema, AJTurnResponseSchema } from '@/types/api';
import type { ItemsResponse, TurnSuccess, AJTurnResponse } from '@/types/api';
import { z } from 'zod';

type Json = unknown;

export async function apiGetItems(): Promise<ItemsResponse['items']> {
  const res = await fetch('/api/items');
  const raw = await res.json().catch(() => null);
  if (!res.ok || !raw) throw new Error(`Items HTTP ${res.status}`);
  const parsed = ItemsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid items response');
  return parsed.data.items;
}

export async function apiPostTurn(args: {
  sessionId: string;
  schemaId: string;
  itemId: string;
  userResponse: string;
  ajMeasurement: Json;
  probeResponse?: string;
}): Promise<TurnSuccess> {
  const res = await fetch('/api/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: args.sessionId,
      schemaId: args.schemaId,
      itemId: args.itemId,
      userResponse: args.userResponse,
      probeResponse: args.probeResponse,
      ajMeasurement: args.ajMeasurement,
    }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok || !raw) throw new Error(raw?.error || `Turn HTTP ${res.status}`);
  const parsed = TurnResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid turn response shape');
  if (parsed.data.ok !== true) throw new Error(parsed.data.error || 'Turn failed');
  return parsed.data;
}

export async function apiPostAJTurn(args: {
  sessionId: string;
  schemaId: string;
  itemId: string;
  userText: string;
  context?: Json | null;
}): Promise<AJTurnResponse> {
  const res = await fetch('/api/aj/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: args.sessionId,
      schemaId: args.schemaId,
      itemId: args.itemId,
      userText: args.userText,
      context: args.context ?? null,
    }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok || !raw) return { ok: false, error: raw?.error || `AJ HTTP ${res.status}` } as any;
  const parsed = AJTurnResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid AJ response shape' } as any;
  return parsed.data;
}

const UpdateSessionResponseSchema = z.object({ ok: z.literal(true), userTag: z.string().nullable() });
export async function apiPatchUpdateSession(sessionId: string, userTag: string): Promise<{ ok: true; userTag: string | null }>
{
  const res = await fetch('/api/update_session', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, userTag }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok || !raw) throw new Error(raw?.error || `UpdateSession HTTP ${res.status}`);
  const parsed = UpdateSessionResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid update_session response');
  return parsed.data;
}

