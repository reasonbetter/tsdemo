// engine/health/bank_health.ts
import fs from "fs/promises";
import path from "path";
import type { ItemEnvelope, SchemaEnvelope } from "@/types/kernel";
import { inspectSchemasAndItems } from "@/engine/kernel/validation";

async function walkJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let ents: any[];
    try { ents = await fs.readdir(d, { withFileTypes: true } as any); }
    catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

export async function inspectBankHealth() {
  const root = path.join(process.cwd(), "data");

  const schemaFiles = [
    ...(await walkJson(path.join(root, "schemas"))),
    ...(await walkJson(path.join(root, "modules")))
  ].filter(f => /[/\\]schemas[/\\]/i.test(f) || /data[/\\]schemas[/\\]/i.test(f));

  const itemFiles = [
    ...(await walkJson(path.join(root, "items"))),
    ...(await walkJson(path.join(root, "modules")))
  ].filter(f => /[/\\]items[/\\]/i.test(f) || /data[/\\]items[/\\]/i.test(f));

  type Load<T> = { file: string; entity?: T; parseError?: string };
  const schemaLoads: Load<SchemaEnvelope>[] = [];
  const itemLoads: Load<ItemEnvelope>[] = [];

  for (const f of schemaFiles) {
    try { schemaLoads.push({ file: f, entity: JSON.parse(await fs.readFile(f, "utf8")) }); }
    catch (e: any) { schemaLoads.push({ file: f, parseError: `JSON Parse Error: ${e?.message ?? e}` }); }
  }
  for (const f of itemFiles) {
    try { itemLoads.push({ file: f, entity: JSON.parse(await fs.readFile(f, "utf8")) }); }
    catch (e: any) { itemLoads.push({ file: f, parseError: `JSON Parse Error: ${e?.message ?? e}` }); }
  }

  const schemas = schemaLoads.map(s => s.entity).filter(Boolean) as SchemaEnvelope[];
  const items   = itemLoads.map(i => i.entity).filter(Boolean) as ItemEnvelope[];

  const { schemaResults, itemResults } = inspectSchemasAndItems(schemas, items);

  const schemaParseRows = schemaLoads.filter(s => s.parseError).map(s => ({ schemaId: s.file, ok: false, error: s.parseError! }));
  const itemParseRows   = itemLoads.filter(i => i.parseError).map(i => ({ itemId: i.file, schemaId: "<unknown>", ok: false, error: i.parseError! }));

  return {
    counts: { schemas: schemaLoads.length, items: itemLoads.length },
    schemaResults: [...schemaParseRows, ...schemaResults],
    itemResults:   [...itemParseRows, ...itemResults],
  };
}
