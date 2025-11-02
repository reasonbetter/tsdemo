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
  const systemGuidance = dc.AJ_System_Guidance ?? (schema as any).AJ_System_Guidance ?? "";
  // Prefer item-level ProbeLibrary; fall back to schema-level for legacy content
  const itemProbeLibrary = (item as any)?.Content?.ProbeLibrary ?? {};
  const schemaProbeLibrary = dc.ProbeLibrary ?? {};
  const probeLibrary = Object.keys(itemProbeLibrary).length > 0 ? itemProbeLibrary : schemaProbeLibrary;
  const dominanceOrder = dc.DominanceOrder ?? [];
  const contract = stringifyCompact(schema.AJ_Contract_JsonSchema);
  const schemaDescription: string | undefined = (schema as any)?.Description || (schema as any)?.description;
  const stem = item.Stem ?? "";

  // Normalize system guidance (string or JSON)
  const sysBase =
    typeof systemGuidance === "string"
      ? systemGuidance
      : `You are the measurement component. Follow this JSON guidance:\n${stringifyCompact(systemGuidance)}`;

  const strictJsonRules = [
    "You MUST return valid strict JSON only.",
    "Do NOT include markdown, code fences, prose, or commentary.",
    "Do NOT include keys that are not allowed by the schema.",
    "No trailing commas; valid strict JSON.",
    "If the JSON Schema permits a plain number, you may return a single number (without quotes) when appropriate.",
  ].join("\n");

  const probeLibraryBlock = Object.keys(probeLibrary).length > 0
    ? `\n\nPROBE LIBRARY (for RecommendedProbeID; prefer item-level if present):\n${stringifyCompact(probeLibrary)}`
    : "";

  const dominanceOrderBlock = dominanceOrder.length > 0
    ? `\n\nDOMINANCE ORDER (If multiple AnswerTypes apply, choose the one that appears earliest in this list):\n${stringifyCompact(dominanceOrder)}`
    : "";

  const schemaDescBlock = schemaDescription ? `\n\nSCHEMA DESCRIPTION:\n${schemaDescription}` : "";
  // Reordered for clarity: put strict rules first, then schema context, then guidance, then dominance order and probe library
  const sys = `STRICT OUTPUT RULES:\n${strictJsonRules}${schemaDescBlock}\n\nMEASUREMENT GUIDANCE:\n${sysBase}${dominanceOrderBlock}${probeLibraryBlock}`;

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
  // Reordered for clarity: stem and user answer first, then context, then schema id and contract
  const user_prompt = `ITEM STEM:\n${stem}\n\nUSER ANSWER:\n${ctx.userText}${contextBlock}\n\nSCHEMA ID: ${schema.SchemaID}\n\nReturn JSON only that conforms to the following JSON Schema (object or boolean):\n\n${contract}\n\nIMPORTANT: Your entire response must be only the JSON object, starting with { and ending with }. Do not repeat the prompt or add any other text.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: user_prompt }
  ];
}
