import { describe, it, expect } from "vitest";
import { enforceProbePolicy } from "./probe_policy";
import type { SchemaEnvelope } from "@/types/kernel";

const schemaBase = {
  SchemaID: "X",
  Engine: { driverId: "d" },
  GuidanceVersion: "1",
  AJ_Contract_JsonSchema: { type: "object" },
} as SchemaEnvelope;

describe("probe policy", () => {
  it("passes library probes unchanged", () => {
    const res = enforceProbePolicy(schemaBase, { id: "good_1", text: "Nice.", category: "Good" });
    expect(res.blocked).toBe(false);
    expect(res.truncated).toBe(false);
    expect(res.probe?.text).toBe("Nice.");
  });

  it("blocks generated probe for disallowed category", () => {
    const res = enforceProbePolicy(schemaBase, { id: null, text: "x", category: "RunsThroughA" });
    expect(res.blocked).toBe(true);
    expect(res.probe?.text).toMatch(/prohibited linkage/i);
  });

  it("allows generated probe for allowed category but truncates if too long", () => {
    const schema = { ...schemaBase, ProbePolicy: { AllowAJGeneratedFor: ["RunsThroughA"], MaxGeneratedChars: 10 } };
    const res = enforceProbePolicy(schema, { id: null, text: "This is a very long generated reminder.", category: "RunsThroughA" });
    expect(res.blocked).toBe(false);
    expect(res.truncated).toBe(true);
    expect(res.probe?.text.length).toBeLessThanOrEqual(11); // includes ellipsis
  });

  it("blocks hinting phrases", () => {
    const schema = { ...schemaBase, ProbePolicy: { AllowAJGeneratedFor: ["RunsThroughA"], DisallowHintPatterns: ["\\bfor example\\b"] } };
    const res = enforceProbePolicy(schema, { id: null, text: "For example, you could say …", category: "RunsThroughA" });
    expect(res.blocked).toBe(true);
  });
});
