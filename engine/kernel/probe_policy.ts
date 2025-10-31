import type { DriverProbe, SchemaEnvelope } from "@/types/kernel";

export type ProbeSanitizeResult = {
  probe: DriverProbe | null;
  blocked: boolean;
  truncated: boolean;
  reason?: string;
};

const DEFAULT_MAX = 160;
const DEFAULT_DISALLOW: RegExp[] = [
  /\bfor example\b/i,
  /\b(e\.g\.|i\.e\.)\b/i,
  /\btry mentioning\b/i,
  /\bconsider saying\b/i,
  /\bbecause\b/i,  // avoid causal hinting
];

export function enforceProbePolicy(schema: SchemaEnvelope, probe: DriverProbe | null): ProbeSanitizeResult {
  if (!probe) return { probe: null, blocked: false, truncated: false };

  const pol = schema.ProbePolicy ?? {};
  const allow = new Set(pol.AllowAJGeneratedFor ?? []);      // e.g., ["RunsThroughA"]
  const maxLen = Math.max(1, Number(pol.MaxGeneratedChars ?? DEFAULT_MAX));
  const bad = (pol.DisallowHintPatterns ?? []).map((p) => {
    try { return new RegExp(p, "i"); } catch { return null; }
  }).filter(Boolean) as RegExp[];

  const disallowPatterns: RegExp[] = [...DEFAULT_DISALLOW, ...bad];

  // Heuristic: id === null means "generated" (library probes must have ids)
  const isGenerated = probe.id == null;

  if (!isGenerated) {
    // Library probe: accept as-is
    return { probe, blocked: false, truncated: false };
  }

  // Generated: category must be explicitly allowed
  const cat = (probe.category ?? "").trim();
  if (!allow.has(cat)) {
    return {
      probe: null,
      blocked: true,
      truncated: false,
      reason: "category_not_allowed",
    };
  }

  // Enforce anti-hinting patterns
  for (const rx of disallowPatterns) {
    if (rx.test(probe.text)) {
      return {
        probe: null,
        blocked: true,
        truncated: false,
        reason: "hinting_pattern",
      };
    }
  }

  // Truncate if too long
  if (probe.text.length > maxLen) {
    return {
      probe: { id: null, category: cat, text: probe.text.slice(0, maxLen - 1) + "…" },
      blocked: false,
      truncated: true,
      reason: "length",
    };
  }

  return { probe, blocked: false, truncated: false };
}
