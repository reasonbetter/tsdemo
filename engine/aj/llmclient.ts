/* engine/aj/llm_client.ts */
import type { Json } from "@/types/kernel";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface LLMJsonOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  // If you use OpenAI-compatible endpoints:
  apiKey?: string;
  apiBase?: string; // e.g., https://api.openai.com/v1
  // Optional: safety net regex to pull JSON out of code fences
  extractJson?: boolean;
}

/** Extract first JSON object/array from a text blob. */
function extractFirstJson(text: string): any {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  const s = (start === -1) ? startArr : (startArr === -1 ? start : Math.min(start, startArr));
  if (s === -1) throw new Error("No JSON found in model output");
  // naive scan to the last brace/bracket
  const lastObj = candidate.lastIndexOf("}");
  const lastArr = candidate.lastIndexOf("]");
  const e = Math.max(lastObj, lastArr);
  const slice = candidate.slice(s, e + 1);
  return JSON.parse(slice);
}

function tryParseJsonString(str: string): any {
  // Quick numeric fallback for schemas that allow numbers
  const t = str.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  // Attempt direct JSON parse
  try { return JSON.parse(t); } catch {}
  // Attempt extraction from fences or embedded JSON
  return extractFirstJson(str);
}

/** Call an OpenAI-compatible chat endpoint and return parsed JSON. */
export async function callLLMWithRaw(
  messages: ChatMessage[],
  opts: LLMJsonOptions = {}
): Promise<{ parsed: Json | null; raw: string; diagnostic: any }>{
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const apiBaseRaw = opts.apiBase ?? process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
  const apiBase = String(apiBaseRaw).replace(/\/+$/, "");

  // Robust model selection: handle empty env strings
  const envModelRaw = typeof process !== "undefined" ? (process.env.OPENAI_MODEL ?? "") : "";
  const envModel = (typeof envModelRaw === "string" ? envModelRaw.trim() : "");
  const optModel = (typeof opts.model === "string" ? opts.model.trim() : "");
  const model = optModel || envModel || "gpt-5-mini";

  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const useMaxCompletion = /gpt-5/i.test(model);
  const body: any = { model, messages };
  // GPT-5 family expects temp=1 by default; others default to 0 for deterministic JSON
  body.temperature = useMaxCompletion ? (opts.temperature ?? 1) : (opts.temperature ?? 0);
  if (useMaxCompletion) body.max_completion_tokens = opts.max_tokens ?? 1500;
  else body.max_tokens = opts.max_tokens ?? 1500;

  const timeoutMsEnv = Number(process.env.AJ_TIMEOUT_MS ?? 0);
  const timeoutMs = Number.isFinite(timeoutMsEnv) && timeoutMsEnv > 0 ? timeoutMsEnv : 30000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error('AJ timeout exceeded')), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal as any,
    });
  } finally {
    clearTimeout(t);
  }
  const rawTxt = await res.text();
  const diagnostic = { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: rawTxt };
  if (!res.ok) return { parsed: null, raw: rawTxt, diagnostic };
  try {
    const data = JSON.parse(rawTxt);
    const msg = data?.choices?.[0]?.message ?? {};
    const toolCalls = msg?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const args = tc?.function?.arguments;
        if (typeof args === "string" && args.trim().length) {
          try { return { parsed: JSON.parse(args), raw: args, diagnostic }; } catch {}
        }
      }
    }
    const fnCallArgs = msg?.function_call?.arguments;
    if (typeof fnCallArgs === "string" && fnCallArgs.trim().length) {
      try { return { parsed: JSON.parse(fnCallArgs), raw: fnCallArgs, diagnostic }; } catch {}
    }
    const content = msg?.content;
    if (typeof content === "string") {
      try { const p = tryParseJsonString(content); return { parsed: p, raw: content, diagnostic }; } catch { return { parsed: null, raw: content, diagnostic }; }
    }
    if (content && typeof content === "object") return { parsed: content as Json, raw: JSON.stringify(content), diagnostic };
    return { parsed: null, raw: rawTxt, diagnostic };
  } catch {
    return { parsed: null, raw: rawTxt, diagnostic };
  }
}

export async function callLLMJson(messages: ChatMessage[], opts: LLMJsonOptions = {}): Promise<Json> {
  const r = await callLLMWithRaw(messages, opts);
  if (r.parsed == null) throw new Error("Model did not return valid JSON");
  return r.parsed;
}
