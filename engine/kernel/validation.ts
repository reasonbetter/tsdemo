/* engine/kernel/validation.ts */
import Ajv, { ValidateFunction } from "ajv";
import type { SchemaEnvelope, ItemEnvelope } from "@/types/kernel";

// Single Ajv instance + cache
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<string, ValidateFunction>();

/** Get or compile/cache the AJ contract validator (handles object or boolean). */
export function getAjValidatorForSchema(schema: SchemaEnvelope): ValidateFunction {
  let v = validators.get(schema.SchemaID);
  if (v) return v;

  const schemaJson = (schema as any).AJ_Contract_JsonSchema;

  // Presence/type of AJ_Contract_JsonSchema is enforced by the envelope validator.
  // We do NOT use a truthiness check here because boolean `false` is valid.
  if (schemaJson === undefined || schemaJson === null) {
    throw new Error(
      `Schema '${schema.SchemaID}' has missing or null AJ_Contract_JsonSchema. This should have been caught by envelope validation.`
    );
  }

  try {
    v = ajv.compile(schemaJson as any); // supports boolean schemas too
  } catch (e: any) {
    throw new Error(`Schema '${schema.SchemaID}' AJ_Contract_JsonSchema failed compilation: ${e?.message ?? e}`);
  }

  validators.set(schema.SchemaID, v);
  return v;
}

/** Validate AJ output for a turn (Safety Catch). Throws on failure. */
export function validateAjOutputOrThrow(schema: SchemaEnvelope, ajRaw: unknown) {
  const validate = getAjValidatorForSchema(schema);
  const ok = validate(ajRaw);
  if (!ok) {
    const msg = `AJ output failed schema validation for '${schema.SchemaID}': ${ajv.errorsText(validate.errors)}`;
    const err = new Error(msg) as Error & { ajvErrors?: unknown };
    (err as any).ajvErrors = validate.errors;
    throw err;
  }
}

/* ---------------- Envelope schemas (loader-time) ----------------------- */

const SchemaEnvelopeJsonSchema = {
  $id: "SchemaEnvelope",
  type: "object",
  required: ["SchemaID", "GuidanceVersion", "AJ_Contract_JsonSchema", "Engine"],
  properties: {
    SchemaID: { type: "string", minLength: 1 },
    Description: { type: "string" },
    GuidanceVersion: { type: "string", minLength: 1 },
    Engine: {
      type: "object",
      properties: { driverId: { type: "string" }, kind: { type: "string" }, version: { type: "string" } },
      additionalProperties: true,
      anyOf: [{ required: ["driverId"] }, { required: ["kind"] }]
    },
    Ability: {
      type: "object",
      properties: {
        key: { type: "string" },
        keys: { type: "array", items: { type: "string" }, minItems: 1 }
      },
      additionalProperties: true
    },
    PolicyDefaults: { type: "object" },
    ScoringSpec: { type: "object" },
    DriverConfig: { type: "object" },
    ProbePolicy: {
      type: "object",
      additionalProperties: true
    },
    AJ_Contract_JsonSchema: {
      // CRITICAL: allow object OR boolean (true/false)
      anyOf: [{ type: "object" }, { type: "boolean" }]
    }
  },
  additionalProperties: true
};

const ItemEnvelopeJsonSchema = {
  $id: "ItemEnvelope",
  type: "object",
  required: ["ItemID", "SchemaID", "Stem"],
  properties: {
    ItemID: { type: "string", minLength: 1 },
    SchemaID: { type: "string", minLength: 1 },
    Stem: { type: "string", minLength: 1 },
    DriverOverrides: { type: "object" },
    Content: { type: "object" }
  },
  additionalProperties: true
};

// Compile once
const validateSchemaEnvelope = ajv.compile(SchemaEnvelopeJsonSchema as any);
const validateItemEnvelope = ajv.compile(ItemEnvelopeJsonSchema as any);

/** Throws with a useful message if invalid. */
export function validateSchemaEnvelopeOrThrow(s: unknown): asserts s is SchemaEnvelope {
  const ok = validateSchemaEnvelope(s);
  if (!ok) {
    // Don't access s.SchemaID here, as it may not be valid.
    throw new Error(
      `Schema envelope invalid: ${ajv.errorsText(validateSchemaEnvelope.errors)}`
    );
  }
}

export function validateItemEnvelopeOrThrow(i: unknown): asserts i is ItemEnvelope {
  const ok = validateItemEnvelope(i);
  if (!ok) {
    throw new Error(
      `Item envelope invalid: ${ajv.errorsText(validateItemEnvelope.errors)}`
    );
  }
}

/** Inspect (non-throwing): validate envelopes and compile AJ contracts; return a report. */
export function inspectSchemasAndItems(schemas: SchemaEnvelope[], items: ItemEnvelope[]) {
  const schemaResults = schemas.map((s, index) => {
    try {
      validateSchemaEnvelopeOrThrow(s);  // structure, presence, types
      getAjValidatorForSchema(s);        // compile AJ contract (object/boolean)
      return { schemaId: s.SchemaID, ok: true, error: null as string | null };
    } catch (e: any) {
      return { schemaId: (s as any)?.SchemaID ?? `Schema at index ${index}`, ok: false, error: String(e?.message || e) };
    }
  });

  const itemResults = items.map((i, index) => {
    try {
      validateItemEnvelopeOrThrow(i);
      if (!schemas.find(s => s.SchemaID === i.SchemaID)) {
        throw new Error(`No matching schema '${i.SchemaID}' for item '${i.ItemID}'`);
      }
      return { itemId: i.ItemID, schemaId: i.SchemaID, ok: true, error: null as string | null };
    } catch (e: any) {
      return { itemId: (i as any)?.ItemID ?? `Item at index ${index}`, schemaId: (i as any)?.SchemaID ?? "<unknown>", ok: false, error: String(e?.message || e) };
    }
  });

  return { schemaResults, itemResults };
}

/** Strict variant: throws if any schema or item invalid. */
export function validateSchemasAndItemsOrThrow(schemas: SchemaEnvelope[], items: ItemEnvelope[]) {
  const { schemaResults, itemResults } = inspectSchemasAndItems(schemas, items);
  const badS = schemaResults.filter(r => !r.ok);
  const badI = itemResults.filter(r => !r.ok);
  if (badS.length || badI.length) {
    const lines = [
      ...badS.map(b => `Schema ${b.schemaId}: ${b.error}`),
      ...badI.map(b => `Item ${b.itemId} (schema ${b.schemaId}): ${b.error}`)
    ];
    throw new Error("Bank validation failed:\n" + lines.join("\n"));
  }
  return { schemaResults, itemResults };
}
