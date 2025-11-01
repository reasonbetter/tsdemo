import type { DriverProbe, SchemaEnvelope } from "@/types/kernel";

export type ProbeSanitizeResult = {
  probe: DriverProbe | null;
  blocked: boolean;
  truncated: boolean;
  reason?: string;
};

// Controlled probe generation is disabled. We only pass through library probes.

export function enforceProbePolicy(_schema: SchemaEnvelope, probe: DriverProbe | null): ProbeSanitizeResult {
  if (!probe) return { probe: null, blocked: false, truncated: false };
  // Library probe: require an id. Any probe without an id is considered generated and is blocked.
  if (probe.id == null) {
    return { probe: null, blocked: true, truncated: false, reason: "generated_probes_disabled" };
  }
  return { probe, blocked: false, truncated: false };
}
