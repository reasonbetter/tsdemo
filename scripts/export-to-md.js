#!/usr/bin/env node
/**
 * Export all schemas and items into a single Markdown document for non-technical review.
 *
 * Usage: node scripts/export-to-md.js [outputPath]
 * Default output: export/bank.md
 */

const fs = require('fs/promises');
const path = require('path');

async function walkJson(dir) {
  const out = [];
  async function walk(d) {
    let ents;
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

async function loadBankLike() {
  const dataRoot = path.join(process.cwd(), 'data');
  const schemaFiles = [
    ...(await walkJson(path.join(dataRoot, 'schemas'))),
    ...(await walkJson(path.join(dataRoot, 'modules'))),
  ].filter(f => /[/\\]schemas[/\\]/i.test(f));
  const itemFiles = [
    ...(await walkJson(path.join(dataRoot, 'items'))),
    ...(await walkJson(path.join(dataRoot, 'modules'))),
  ].filter(f => /[/\\]items[/\\]/i.test(f));

  const schemasArr = [];
  for (const f of schemaFiles) {
    try { schemasArr.push(JSON.parse(await fs.readFile(f, 'utf8'))); }
    catch (e) { throw new Error(`Failed to parse schema '${f}': ${e.message || e}`); }
  }
  const itemsArr = [];
  for (const f of itemFiles) {
    try { itemsArr.push(JSON.parse(await fs.readFile(f, 'utf8'))); }
    catch (e) { throw new Error(`Failed to parse item '${f}': ${e.message || e}`); }
  }

  const schemas = Object.fromEntries(schemasArr.map(s => [s.SchemaID, s]));
  return { schemas, items: itemsArr };
}

function mdEscapeInline(s) {
  if (typeof s !== 'string') return String(s ?? '');
  return s.replace(/\|/g, '\\|');
}

function asList(val) {
  return Array.isArray(val) ? val : (val == null ? [] : [val]);
}

function renderExamples(examples) {
  if (!examples || typeof examples !== 'object') return '';
  const cats = Object.keys(examples);
  if (cats.length === 0) return '';
  let out = '';
  for (const cat of cats) {
    const arr = asList(examples[cat]);
    if (arr.length === 0) continue;
    out += `- ${cat}:\n`;
    for (const e of arr) {
      if (e && typeof e === 'object') {
        const t = e.text ? String(e.text) : '';
        const ex = e.explanation ? ` ( ${String(e.explanation)} )` : '';
        if (t) out += `  - ${t}${ex}\n`;
      } else if (typeof e === 'string') {
        out += `  - ${e}\n`;
      }
    }
  }
  return out;
}

function renderProbeLibrary(lib) {
  if (!lib || typeof lib !== 'object') return '';
  const cats = Object.keys(lib);
  if (cats.length === 0) return '';
  let out = '';
  for (const cat of cats) {
    const probes = asList(lib[cat]);
    const texts = probes
      .map(p => (p && typeof p === 'object' ? p.text : null))
      .filter(Boolean);
    if (texts.length === 0) continue;
    out += `- ${cat}:\n`;
    for (const t of texts) out += `  - ${String(t)}\n`;
  }
  return out;
}

async function main() {
  const outPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), 'export', 'bank.md');
  const outDir = path.dirname(outPath);
  await fs.mkdir(outDir, { recursive: true });

  const bank = await loadBankLike();
  const schemaIds = Object.keys(bank.schemas).sort((a, b) => a.localeCompare(b));
  const itemsBySchema = new Map();
  for (const it of bank.items) {
    const sid = it.SchemaID || 'UnknownSchema';
    if (!itemsBySchema.has(sid)) itemsBySchema.set(sid, []);
    itemsBySchema.get(sid).push(it);
  }
  for (const sid of itemsBySchema.keys()) {
    itemsBySchema.get(sid).sort((a, b) => String(a.ItemID).localeCompare(String(b.ItemID)));
  }

  const lines = [];
  const now = new Date().toISOString();
  lines.push(`# Assessment Bank Export`);
  lines.push(`Generated: ${now}`);
  lines.push('');
  lines.push(`Schemas: ${schemaIds.length}  •  Items: ${bank.items.length}`);
  lines.push('');

  // TOC
  lines.push('## Table of Contents');
  for (const sid of schemaIds) {
    lines.push(`- [${sid}](#schema-${sid.toLowerCase()})`);
  }
  lines.push('');

  for (const sid of schemaIds) {
    const s = bank.schemas[sid];
    lines.push(`## Schema: ${s.SchemaID}`);
    lines.push(`<a id="schema-${s.SchemaID.toLowerCase()}"></a>`);
    if (s.Description) lines.push(`- Description: ${s.Description}`);
    if (s.Ability && (s.Ability.key || (Array.isArray(s.Ability.keys) && s.Ability.keys.length))) {
      const key = s.Ability.key || s.Ability.keys?.[0];
      if (key) lines.push(`- Ability: ${key}`);
    }
    lines.push('');

    const items = itemsBySchema.get(sid) || [];
    for (const it of items) {
      const stem = String(it.Stem || '').trim();
      lines.push(`### ${it.ItemID}`);
      if (stem) lines.push(`Stem: ${mdEscapeInline(stem)}`);

      const meWith = Array.isArray(it.MutuallyExclusiveWith) ? it.MutuallyExclusiveWith : [];
      const meGrp = it.MutuallyExclusiveGroup;
      if (meWith.length || meGrp) {
        lines.push('- Mutually Exclusive:');
        if (meGrp) lines.push(`  - Group: ${meGrp}`);
        if (meWith.length) lines.push(`  - With: ${meWith.join(', ')}`);
      }

      const content = it.Content || {};
      const scen = content.ScenarioDefinition || {};
      const scenKeys = Object.keys(scen);
      if (scenKeys.length) {
        lines.push('- Scenario:');
        if (scen.A_text) lines.push(`  - A: ${scen.A_text}`);
        if (scen.B_text) lines.push(`  - B: ${scen.B_text}`);
        for (const k of scenKeys) {
          if (k === 'A_text' || k === 'B_text') continue;
          const v = scen[k];
          if (v != null && v !== '') lines.push(`  - ${k.replace(/_/g, ' ')}: ${String(v)}`);
        }
      }

      const reg = Array.isArray(content.ThemeRegistry) ? content.ThemeRegistry : [];
      if (reg.length) {
        lines.push('- Theme Registry:');
        for (const t of reg) {
          const aliases = Array.isArray(t.Aliases) ? t.Aliases.join('; ') : '';
          lines.push(`  - ${t.ThemeID}${aliases ? ` — ${aliases}` : ''}`);
        }
      }

      const tooGen = Array.isArray(content.TooGeneral) ? content.TooGeneral : [];
      if (tooGen.length) {
        lines.push(`- Too General: ${tooGen.join(', ')}`);
      }

      const examples = content.Examples;
      const exRendered = renderExamples(examples);
      if (exRendered) {
        lines.push('- Examples:');
        lines.push(exRendered.trimEnd());
      }

      const probes = content.ProbeLibrary;
      const prRendered = renderProbeLibrary(probes);
      if (prRendered) {
        lines.push('- Probes:');
        lines.push(prRendered.trimEnd());
      }

      lines.push('');
    }
  }

  await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Exported ${schemaIds.length} schemas and ${bank.items.length} items to: ${outPath}`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
