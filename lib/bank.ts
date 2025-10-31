// lib/bank.ts
import fs from "fs/promises";
import path from "path";
import type { SchemaEnvelope, ItemEnvelope } from "@/types/kernel";
import { validateSchemasAndItemsOrThrow } from "@/engine/kernel/validation";

export interface Bank {
  schemas: Record<string, SchemaEnvelope>;
  items: ItemEnvelope[];
}

export function getSchemaById(bank: Bank, id: string): SchemaEnvelope {
  const s = bank.schemas[id];
  if (!s) throw new Error(`Schema '${id}' not found`);
  return s;
}
export function getItemById(bank: Bank, id: string): ItemEnvelope {
  const it = bank.items.find(i => i.ItemID === id);
  if (!it) throw new Error(`Item '${id}' not found`);
  return it;
}

async function walkJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let ents: any[];
    try { ents = await fs.readdir(d, { withFileTypes: true } as any); }
    catch { return; } // directory may not exist
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

let _cache: { bank: Bank; at: number } | null = null;

export async function loadBank(): Promise<Bank> {
  const ttlMsRaw = Number(process.env.BANK_CACHE_TTL_MS ?? 0);
  const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? ttlMsRaw : 0;
  if (ttlMs > 0 && _cache && (Date.now() - _cache.at) < ttlMs) {
    return _cache.bank;
  }
  const dataRoot = path.join(process.cwd(), "data");

  // Collect schema files from both legacy and modular layout
  const schemaFiles = [
    ...(await walkJson(path.join(dataRoot, "schemas"))),
    ...(await walkJson(path.join(dataRoot, "modules"))),
  ].filter(f => /[/\\]schemas[/\\]/i.test(f));

  // Collect item files from both legacy and modular layout
  const itemFiles = [
    ...(await walkJson(path.join(dataRoot, "items"))),
    ...(await walkJson(path.join(dataRoot, "modules"))),
  ].filter(f => /[/\\]items[/\\]/i.test(f));

  const schemasArr: SchemaEnvelope[] = [];
  for (const f of schemaFiles) {
    try {
      const j = JSON.parse(await fs.readFile(f, "utf8"));
      schemasArr.push(j);
    } catch (e: any) {
      throw new Error(`Failed to parse schema JSON '${f}': ${e?.message ?? e}`);
    }
  }

  const items: ItemEnvelope[] = [];
  for (const f of itemFiles) {
    try {
      const j = JSON.parse(await fs.readFile(f, "utf8"));
      items.push(j);
    } catch (e: any) {
      throw new Error(`Failed to parse item JSON '${f}': ${e?.message ?? e}`);
    }
  }

  // Validate envelopes + compile AJ contracts (throws on failure)
  validateSchemasAndItemsOrThrow(schemasArr, items);

  const schemas: Record<string, SchemaEnvelope> = Object.fromEntries(schemasArr.map(s => [s.SchemaID, s]));
  const bank = { schemas, items };
  if (ttlMs > 0) _cache = { bank, at: Date.now() };
  return bank;
}
