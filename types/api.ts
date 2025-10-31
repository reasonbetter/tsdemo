import { z } from 'zod';
import type { TranscriptEntryLabel, TranscriptExchangeLabel } from '@/types/kernel';

// Shared JSON-ish placeholder for unstructured payloads (telemetry, AJ output, etc.)
export const JsonSchema: z.ZodType<unknown> = z.unknown();

// --- Kernel shared shapes (zod) ---

export const ThetaComponentSchema = z.object({ mean: z.number(), var: z.number() });
export const ThetaStateSchema = z.record(ThetaComponentSchema);

export const DriverProbeSchema = z.object({
  id: z.string().nullable(),
  text: z.string(),
  category: z.string().optional(),
});

export const UnitStateMetaSchema = z.object({
  driverId: z.string(),
  driverVersion: z.string(),
  contractVersion: z.string(),
  schemaId: z.string(),
  itemId: z.string(),
  abilityKey: z.string(),
  startedAtMs: z.number(),
  turnCount: z.number(),
  attempts: z.number().optional(),
  consecutiveUnproductive: z.number().optional(),
  totalUnproductive: z.number().optional(),
});

export const UnitStateEnvelopeSchema = z.object({
  meta: UnitStateMetaSchema,
  payload: JsonSchema,
});

// Label unions mirrored from types/kernel.ts
const DriverAnswerTypeLiterals = [
  'Good','NotDistinct','NotSpecific','NotClear','NotRelevant','NotPlausible','RunsThroughA','MultipleExplanation'
] as const;
const LegacyAssessmentLabelLiterals = [
  'Correct','Incomplete','Flawed','Incorrect','Ambiguous','Off_Topic'
] as const;

export const TranscriptEntryLabelSchema = z.union([
  z.literal('kernel'),
  z.enum(LegacyAssessmentLabelLiterals),
  z.enum(DriverAnswerTypeLiterals),
]) as z.ZodType<TranscriptEntryLabel>;

export const TranscriptExchangeLabelSchema = z.union([
  z.literal('None'),
  TranscriptEntryLabelSchema,
]) as z.ZodType<TranscriptExchangeLabel>;

export const TranscriptExchangeSchema = z.object({
  probe_text: z.string(),
  probe_answer: z.string(),
  label: TranscriptExchangeLabelSchema,
});

export const DisplayThetaSchema = z.object({ mean: z.number(), se: z.number() });
export const ThetaStateOrDisplaySchema = z.union([ThetaStateSchema, DisplayThetaSchema]);

export const TranscriptEntrySchema = z.object({
  item_id: z.string(),
  text: z.string(),
  answer: z.string(),
  label: TranscriptEntryLabelSchema,
  theta_state_before: ThetaStateOrDisplaySchema,
  exchanges: z.array(TranscriptExchangeSchema),
  probe_text: z.string().optional(),
  probe_answer: z.string().optional(),
  probe_rationale: z.string().optional(),
  final_score: z.number().optional(),
  final_rationale: z.string().optional(),
});

export const TranscriptSchema = z.array(TranscriptEntrySchema);

// --- API envelopes ---

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const TurnSuccessSchema = z.object({
  ok: z.literal(true),
  probe: DriverProbeSchema.nullable(),
  completed: z.boolean(),
  theta: ThetaStateSchema,
  unitState: UnitStateEnvelopeSchema,
  telemetry: JsonSchema,
  transcript: TranscriptSchema,
});
export type TurnSuccess = z.infer<typeof TurnSuccessSchema>;

export const TurnResponseSchema = z.union([TurnSuccessSchema, ApiErrorSchema]);
export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export const ItemsResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(z.object({
    ItemID: z.string(),
    SchemaID: z.string(),
    Stem: z.string(),
    MutuallyExclusiveWith: z.array(z.string()).optional(),
    MutuallyExclusiveGroup: z.string().optional(),
  })),
});
export type ItemsResponse = z.infer<typeof ItemsResponseSchema>;

// --- AJ turn envelope (flexible measurement) ---
export const AJTurnSuccessSchema = z.object({
  ok: z.literal(true),
  measurement: z.unknown(),
  debug: z.any().optional(),
});
export type AJTurnSuccess = z.infer<typeof AJTurnSuccessSchema>;

export const AJTurnErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  debug: z.any().optional(),
});
export type AJTurnError = z.infer<typeof AJTurnErrorSchema>;

export const AJTurnResponseSchema = z.union([AJTurnSuccessSchema, AJTurnErrorSchema]);
export type AJTurnResponse = z.infer<typeof AJTurnResponseSchema>;
