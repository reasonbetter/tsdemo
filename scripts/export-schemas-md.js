#!/usr/bin/env node
/**
 * Export all schema definitions (no items) into a single Markdown document
 * suitable for non-technical review.
 *
 * Usage: node scripts/export-schemas-md.js [outputPath]
 * Default output: export/schemas.md
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

async function loadSchemas() {
  const dataRoot = path.join(process.cwd(), 'data');
  const schemaFiles = [
    ...(await walkJson(path.join(dataRoot, 'schemas'))),
    ...(await walkJson(path.join(dataRoot, 'modules'))),
  ].filter(f => /[/\\]schemas[/\\]/i.test(f));
  const schemasArr = [];
  for (const f of schemaFiles) {
    try { schemasArr.push(JSON.parse(await fs.readFile(f, 'utf8'))); }
    catch (e) { throw new Error(`Failed to parse schema '${f}': ${e.message || e}`); }
  }
  return schemasArr;
}

function mdEscapeInline(s) {
  if (typeof s !== 'string') return String(s ?? '');
  return s.replace(/\|/g, '\\|');
}

function pushIf(lines, cond, text) { if (cond) lines.push(text); }

function renderKeyVals(obj, indent = '') {
  if (!obj || typeof obj !== 'object') return [];
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${indent}- ${k}: ${v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(', ')}`);
    } else if (typeof v === 'object') {
      const sub = renderKeyVals(v, indent + '  ');
      if (sub.length) {
        lines.push(`${indent}- ${k}:`);
        lines.push(...sub);
      }
    } else {
      lines.push(`${indent}- ${k}: ${String(v)}`);
    }
  }
  return lines;
}

function renderAnswerTypeCatalog(cat) {
  if (!Array.isArray(cat) || cat.length === 0) return [];
  const lines = ['- Answer Types:'];
  for (const e of cat) {
    if (!e || typeof e !== 'object') continue;
    const id = e.id ?? e.name ?? 'Type';
    const desc = e.description ? ` — ${e.description}` : '';
    lines.push(`  - ${id}${desc}`);
  }
  return lines;
}

function renderAJContract(contract) {
  if (!contract || typeof contract !== 'object') return [];
  const lines = ['- AJ Contract:'];
  const t = typeof contract === 'boolean' ? (contract ? 'any' : 'none') : (contract.type || 'object');
  lines.push(`  - Type: ${t}`);
  const props = contract.properties && typeof contract.properties === 'object' ? contract.properties : null;
  if (props) {
    lines.push('  - Properties:');
    for (const [name, spec] of Object.entries(props)) {
      if (!spec || typeof spec !== 'object') continue;
      const types = Array.isArray(spec.type) ? spec.type.join('|') : (spec.type || 'any');
      const enumVals = Array.isArray(spec.enum) ? ` [${spec.enum.join(', ')}]` : '';
      lines.push(`    - ${name}: ${types}${enumVals}`);
    }
  }
  if (Array.isArray(contract.required) && contract.required.length) {
    lines.push(`  - Required: ${contract.required.join(', ')}`);
  }
  if (typeof contract.additionalProperties === 'boolean') {
    lines.push(`  - Additional Properties: ${contract.additionalProperties ? 'allowed' : 'not allowed'}`);
  }
  return lines;
}

async function main() {
  const outPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), 'export', 'schemas.md');
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const schemas = await loadSchemas();
  schemas.sort((a, b) => String(a.SchemaID).localeCompare(String(b.SchemaID)));

  const lines = [];
  lines.push('# Assessment Schemas Export');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Schemas: ${schemas.length}`);
  lines.push('');
  lines.push('## Table of Contents');
  for (const s of schemas) {
    lines.push(`- [${s.SchemaID}](#schema-${String(s.SchemaID).toLowerCase()})`);
  }
  lines.push('');

  for (const s of schemas) {
    lines.push(`## Schema: ${s.SchemaID}`);
    lines.push(`<a id="schema-${String(s.SchemaID).toLowerCase()}"></a>`);
    pushIf(lines, !!s.Description, `- Description: ${mdEscapeInline(s.Description)}`);
    const engine = s.Engine || {};
    const engBits = [];
    if (engine.driverId) engBits.push(`driverId=${engine.driverId}`);
    if (engine.kind) engBits.push(`kind=${engine.kind}`);
    if (engine.version) engBits.push(`version=${engine.version}`);
    if (engBits.length) lines.push(`- Engine: ${engBits.join(', ')}`);
    pushIf(lines, !!s.GuidanceVersion, `- Guidance Version: ${s.GuidanceVersion}`);
    const abilityKey = s.Ability?.key || (Array.isArray(s.Ability?.keys) ? s.Ability.keys[0] : null);
    pushIf(lines, !!abilityKey, `- Ability: ${abilityKey}`);

    // Policy Defaults
    const pol = s.PolicyDefaults;
    if (pol && typeof pol === 'object' && Object.keys(pol).length) {
      lines.push('- Policy Defaults:');
      lines.push(...renderKeyVals(pol, '  '));
    }

    // Driver Config
    const dc = s.DriverConfig || {};
    if (dc && typeof dc === 'object' && Object.keys(dc).length) {
      lines.push('- Driver Config:');
      const aj = dc.AJ_System_Guidance || {};
      if (aj && typeof aj === 'object') {
        const atc = renderAnswerTypeCatalog(aj.AnswerTypeCatalog);
        if (atc.length) lines.push(...atc.map(l => '  ' + l));
        if (Array.isArray(aj.AnswerTypeGuidance) && aj.AnswerTypeGuidance.length) {
          lines.push('  - Answer Type Guidance:');
          for (const g of aj.AnswerTypeGuidance) lines.push(`    - ${g}`);
        }
        if (Array.isArray(aj.ProbingGuidance) && aj.ProbingGuidance.length) {
          lines.push('  - Probing Guidance:');
          for (const g of aj.ProbingGuidance) lines.push(`    - ${g}`);
        }
      }
      const tbo = Array.isArray(dc['Tie-BreakingOrder']) && dc['Tie-BreakingOrder'].length
        ? dc['Tie-BreakingOrder']
        : (Array.isArray(dc.DominanceOrder) && dc.DominanceOrder.length ? dc.DominanceOrder : null);
      if (tbo) {
        lines.push(`  - Tie-Breaking Order: ${tbo.join(' → ')}`);
      }
      if (dc.ConfidencePolicy) {
        lines.push('  - Confidence Policy:');
        lines.push(...renderKeyVals(dc.ConfidencePolicy, '    '));
      }
      if (typeof dc.MaxClarificationAttempts === 'number') {
        lines.push(`  - Max Clarification Attempts: ${dc.MaxClarificationAttempts}`);
      }
      if (dc.ClarificationPolicy) {
        lines.push('  - Clarification Policy:');
        lines.push(...renderKeyVals(dc.ClarificationPolicy, '    '));
      }
      if (dc.AnswerTypeMap && typeof dc.AnswerTypeMap === 'object' && Object.keys(dc.AnswerTypeMap).length) {
        lines.push('  - Answer Type Map:');
        for (const [k, v] of Object.entries(dc.AnswerTypeMap)) lines.push(`    - ${k} → ${v}`);
      }
      if (typeof dc.RunsThroughCategoryLabel === 'string') {
        lines.push(`  - RunsThrough Category Label: ${dc.RunsThroughCategoryLabel}`);
      }
      if (dc.ProbeCategoryFor && typeof dc.ProbeCategoryFor === 'object' && Object.keys(dc.ProbeCategoryFor).length) {
        lines.push('  - Probe Category For:');
        for (const [k, v] of Object.entries(dc.ProbeCategoryFor)) lines.push(`    - ${k} → ${v}`);
      }
    }

    // Scoring Spec
    const sc = s.ScoringSpec || {};
    if (sc && typeof sc === 'object' && Object.keys(sc).length) {
      lines.push('- Scoring Spec:');
      if (sc.type) lines.push(`  - Type: ${sc.type}`);
      if (sc.default) {
        lines.push('  - Default:');
        lines.push(...renderKeyVals(sc.default, '    '));
      }
      if (sc.TargetDistinctExplanations != null) {
        lines.push(`  - Target Distinct Explanations: ${sc.TargetDistinctExplanations}`);
      }
      if (sc.final && sc.final.perDistinct) {
        lines.push('  - Final perDistinct:');
        for (const [k, v] of Object.entries(sc.final.perDistinct)) lines.push(`    - ${k}: ${v}`);
      }
      if (sc.maps && typeof sc.maps === 'object') {
        lines.push('  - Maps:');
        for (const [mapId, arr] of Object.entries(sc.maps)) {
          lines.push(`    - ${mapId}:`);
          if (Array.isArray(arr)) {
            for (const m of arr) {
              const crit = m.criteria != null ? ` — ${m.criteria}` : '';
              lines.push(`      - score ${m.score}${crit}`);
            }
          }
        }
      }
      if (sc.theta && typeof sc.theta === 'object') {
        lines.push('  - Theta:');
        lines.push(...renderKeyVals(sc.theta, '    '));
      }
    }

    // Probe Policy (if present)
    const pr = s.ProbePolicy;
    if (pr && typeof pr === 'object' && Object.keys(pr).length) {
      lines.push('- Probe Policy:');
      lines.push(...renderKeyVals(pr, '  '));
    }

    // AJ Contract (summarized)
    const contract = s.AJ_Contract_JsonSchema;
    if (contract !== undefined) {
      lines.push(...renderAJContract(contract));
    }

    lines.push('');
  }

  await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Exported ${schemas.length} schemas to: ${outPath}`);
}

main().catch((err) => { console.error(err?.stack || String(err)); process.exit(1); });
