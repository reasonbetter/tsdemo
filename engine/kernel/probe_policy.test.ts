import { describe, it, expect } from "vitest";
import { enforceProbePolicy } from "./probe_policy";
import type { SchemaEnvelope } from "@/types/kernel";

const schemaBase = {
  SchemaID: "X",
  Engine: { driverId: "d" },
  GuidanceVersion: "1",
  AJ_Contract_JsonSchema: { type: "object" },
} as SchemaEnvelope;

describe("probe policy (no generated probes)", () => {
  it("passes library probes unchanged", () => {
    const res = enforceProbePolicy(schemaBase, { id: "good_1", text: "Nice.", category: "Good" });
    expect(res.blocked).toBe(false);
    expect(res.truncated).toBe(false);
    expect(res.probe?.text).toBe("Nice.");
  });

  it("blocks any generated probe (id == null)", () => {
    const res = enforceProbePolicy(schemaBase, { id: null, text: "x", category: "RunsThroughA" });
    expect(res.blocked).toBe(true);
    expect(res.probe).toBeNull();
  });
});
