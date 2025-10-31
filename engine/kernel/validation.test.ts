/* engine/kernel/validation.test.ts */
import { describe, it, expect } from "vitest";
import { validateSchemaEnvelopeOrThrow, validateItemEnvelopeOrThrow, inspectSchemasAndItems } from "./validation";
import type { SchemaEnvelope, ItemEnvelope } from "@/types/kernel";

describe("schema & item validation", () => {
  it("fails when GuidanceVersion missing", () => {
    const bad = {
      SchemaID: "X",
      Engine: { driverId: "d" },
      AJ_Contract_JsonSchema: { type: "object" }
    } as any as SchemaEnvelope;
    expect(() => validateSchemaEnvelopeOrThrow(bad)).toThrow(/GuidanceVersion/);
  });

  it("inspects schemas, compiles AJ contracts, and accepts boolean schemas", () => {
    const schemas: SchemaEnvelope[] = [
      {
        SchemaID: "A",
        Engine: { driverId: "d" },
        GuidanceVersion: "1.0.0",
        AJ_Contract_JsonSchema: { type: "object", properties: { x: { type: "number" } }, additionalProperties: true }
      } as any,
      {
        SchemaID: "B",
        Engine: { driverId: "d" },
        GuidanceVersion: "1.0.0",
        AJ_Contract_JsonSchema: false
      } as any
    ];
    const { schemaResults } = inspectSchemasAndItems(schemas, []);
    expect(schemaResults.every(r => r.ok)).toBe(true);
  });

  it("validates minimal item envelope", () => {
    const item: ItemEnvelope = { ItemID: "I1", SchemaID: "S1", Stem: "Q?" };
    expect(() => validateItemEnvelopeOrThrow(item)).not.toThrow();
  });
});
