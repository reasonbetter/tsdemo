/* engine/aj/build_prompt.ts */
import type { ChatMessage } from "./llmclient";
import type { SchemaEnvelope, ItemEnvelope, Json } from "@/types/kernel";

function stringifyCompact(o: unknown): string {
  try { return JSON.stringify(o, null, 2); } catch { return String(o); }
}

export interface TurnContext {
  userText: string;
  // Optional context the kernel may pass (for AEG)
  AcceptedThemeTags?: string[];
  DistinctCountSoFar?: number;
  TargetDistinctExplanations?: number;
  UsedProbeIDs?: string[];
  ScenarioDefinition?: { A_text?: string; B_text?: string };
}

/** Build messages for the AJ call, schema-aware but generic. */
export function buildAjMessages(schema: SchemaEnvelope, item: ItemEnvelope, ctx: TurnContext): ChatMessage[] {
  const dc: any = (schema as any).DriverConfig ?? {};
  const ajSys: any = dc.AJ_System_Guidance ?? (schema as any).AJ_System_Guidance ?? {};
  // Prefer item-level ProbeLibrary; fall back to schema-level for legacy content
  const itemProbeLibrary = (item as any)?.Content?.ProbeLibrary ?? {};
  const schemaProbeLibrary = dc.ProbeLibrary ?? {};
  const probeLibrary = Object.keys(itemProbeLibrary).length > 0 ? itemProbeLibrary : schemaProbeLibrary;
  const dominanceOrder = dc.DominanceOrder ?? [];
  const contract = stringifyCompact(schema.AJ_Contract_JsonSchema);
  const schemaDescription: string | undefined = (schema as any)?.Description || (schema as any)?.description;
  const stem = item.Stem ?? "";

  // Extract structured guidance components (break apart AJ_System_Guidance)
  const answerTypeGuidance = Array.isArray(ajSys?.AnswerTypeGuidance) ? ajSys.AnswerTypeGuidance : undefined;
  const answerTypeCatalog = Array.isArray(ajSys?.AnswerTypeCatalog) ? ajSys.AnswerTypeCatalog : undefined;
  const probingGuidance = Array.isArray(ajSys?.ProbingGuidance) ? ajSys.ProbingGuidance : undefined;
  const freeformGuidance: string | undefined = typeof ajSys === 'string' ? String(ajSys) : undefined;

  // Keep this concise per product direction: title + single rule
  const strictJsonRules = "You MUST return valid strict JSON only.";

  const probeLibraryBlock = Object.keys(probeLibrary).length > 0
    ? `\n\nPROBE LIBRARY:\n${stringifyCompact(
        Object.fromEntries(
          Object.entries(probeLibrary as any).map(([k, arr]: any) => [k, (arr || []).map((p: any) => ({ id: p.id, text: p.text }))])
        )
      )}`
    : "";

  const dominanceOrderBlock = dominanceOrder.length > 0
    ? `\n\nTIE-BREAKING ORDER:\n${dominanceOrder.join(', ')}`
    : "";

  const schemaDescBlock = schemaDescription ? `\n\nSCHEMA DESCRIPTION:\n${schemaDescription}` : "";
  function coreTaskForSchema(s: SchemaEnvelope): string {
    const id = s.SchemaID;
    switch (id) {
      case 'AlternativeExplanationGeneration':
        return "Evaluate one alternative explanation for the A–B association; classify the AnswerType (and ThemeTag when required).";
      case 'BiasDirectionOpen':
        return "Classify the user's explanation of a null result into Masked Benefit, Masked Harm, Both, or a quality category; return a single AnswerType.";
      case 'BiasDirectionSequential':
        return "For one direction this turn (BiasPositive or BiasNegative), identify a selection/sampling mechanism and return a single AnswerType.";
      case 'SelectionEffectIdentification':
        return "Identify a specific selection effect consistent with stated constraints that explains the association; return a single AnswerType.";
      default:
        return "Evaluate the user's answer for this item and return exactly one JSON object that conforms to the JSON Schema.";
    }
  }
  const coreTask = `\n\nCORE TASK:\n${coreTaskForSchema(schema)}`;
  const atGuidanceBlock = answerTypeGuidance && answerTypeGuidance.length ? `\n\nANSWERTYPEGUIDANCE:\n${stringifyCompact(answerTypeGuidance)}` : "";
  const atCatalogBlock = answerTypeCatalog && answerTypeCatalog.length ? `\n\nANSWERTYPECATALOG:\n${stringifyCompact(answerTypeCatalog)}` : "";
  const probingGuidanceBlock = probingGuidance && probingGuidance.length ? `\n\nPROBING GUIDANCE:\n${stringifyCompact(probingGuidance)}` : "";
  const freeformBlock = freeformGuidance ? `\n\n${freeformGuidance}` : "";

  // OUTPUT CONTRACT: summarize expected keys from the JSON schema (short form)
  function outputContractFromSchema(s: SchemaEnvelope): string {
    const c: any = (s as any).AJ_Contract_JsonSchema ?? {};
    const props = Object.keys(c.properties || {});
    const required: string[] = Array.isArray(c.required) ? c.required : [];
    const parts = props.map((k) => (required.includes(k) ? `${k} (required)` : `${k} (optional)`));

    const extras: string[] = [];
    switch (s.SchemaID) {
      case 'AlternativeExplanationGeneration': {
        extras.push('ThemeTag required when AnswerType is Good or NotDistinct; otherwise omit.');
        extras.push('Single explanation only.');
        break;
      }
      case 'SelectionEffectIdentification': {
        extras.push('ThemeTag required when AnswerType is Good or NotDistinct; otherwise omit.');
        extras.push('RejectsAssumption indicates violation of a stated constraint.');
        break;
      }
      case 'BiasDirectionOpen': {
        extras.push('Choose exactly one: Both_Explained, MaskedBenefit_Only_Explained, MaskedHarm_Only_Explained, or a quality label.');
        break;
      }
      case 'BiasDirectionSequential': {
        extras.push('Choose exactly one direction per turn: BiasPositive or BiasNegative (or a quality label).');
        break;
      }
      default: {
        break;
      }
    }

    const extrasStr = extras.length ? ` ${extras.join(' ')}` : '';
    return `Expected keys: ${parts.join(', ')}.${extrasStr} Return exactly one classification per turn.`;
  }

  // Minimal system message: core task + output contract + strict JSON rule
  const sys = `CORE TASK:\n${coreTaskForSchema(schema)}\n\nOUTPUT CONTRACT:\n${outputContractFromSchema(schema)}\n\nSTRICT OUTPUT RULES:\n${strictJsonRules}`;

  const contextBits: string[] = [];
  const content: any = (item as any)?.Content ?? {};
  if (ctx.ScenarioDefinition || content.ScenarioDefinition) {
    const sd = ctx.ScenarioDefinition ?? content.ScenarioDefinition;
    contextBits.push(`Scenario A/B labels: ${stringifyCompact(sd)}`);
  }
  if (Array.isArray(content.ThemeRegistry) && content.ThemeRegistry.length) {
    contextBits.push(`ThemeRegistry (use ThemeID for ThemeTag, or NOVEL:label):\n${stringifyCompact(content.ThemeRegistry)}`);
  }
  if (Array.isArray(content.TooGeneral) && content.TooGeneral.length) {
    contextBits.push(`TooGeneral examples:\n${stringifyCompact(content.TooGeneral)}`);
  }
  if (ctx.AcceptedThemeTags) {
    contextBits.push(`AcceptedThemeTags so far: ${stringifyCompact(ctx.AcceptedThemeTags)}`);
  }
  if (typeof ctx.DistinctCountSoFar === "number") {
    contextBits.push(`DistinctCountSoFar: ${ctx.DistinctCountSoFar}`);
  }
  if (typeof ctx.TargetDistinctExplanations === "number") {
    contextBits.push(`TargetDistinctExplanations: ${ctx.TargetDistinctExplanations}`);
  }
  if (ctx.UsedProbeIDs && ctx.UsedProbeIDs.length) {
    contextBits.push(`UsedProbeIDs: ${stringifyCompact(ctx.UsedProbeIDs)}`);
  }

  const contextBlock = contextBits.length > 0 ? `\n\nCONTEXT:\n${contextBits.join("\n\n")}` : "";
  // Interleaved layout in a single user message
  const user_combined = `STEM:\n${stem}\n\nUSER ANSWER:\n${ctx.userText}${contextBlock}${schemaDescBlock}${dominanceOrderBlock}${atGuidanceBlock}${atCatalogBlock}${probingGuidanceBlock}${probeLibraryBlock}\n\nJSON SCHEMA:\n${contract}${freeformBlock}`;

  return [
    { role: "system", content: sys },
    { role: "user", content: user_combined },
  ];
}
