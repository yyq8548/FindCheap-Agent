import { z } from "zod";
import { FINDCHEAP_VERSION } from "../../../config/version.js";

const CardStageDurationSchema = z.number().nonnegative().max(300_000);

const ProductCardStagesSchema = z.object({
  IFRAME_LOADED: CardStageDurationSchema.optional(),
  RESOURCE_EVALUATED: CardStageDurationSchema.optional(),
  INITIALIZE_SENT: CardStageDurationSchema.optional(),
  INITIALIZE_RETRY: CardStageDurationSchema.optional(),
  INITIALIZE_ACK: CardStageDurationSchema.optional(),
  COMPAT_BRIDGE_READY: CardStageDurationSchema.optional(),
  COMPAT_OUTPUT_RECEIVED: CardStageDurationSchema.optional(),
  TOOL_INPUT_RECEIVED: CardStageDurationSchema.optional(),
  TOOL_OUTPUT_RECEIVED: CardStageDurationSchema.optional(),
  RENDER_STARTED: CardStageDurationSchema.optional(),
  DOM_RENDERED: CardStageDurationSchema.optional(),
  FIRST_IMAGE_PAINTED: CardStageDurationSchema.optional(),
  FIRST_IMAGE_SETTLED: CardStageDurationSchema.optional(),
  TOOL_OUTPUT_TIMEOUT: CardStageDurationSchema.optional(),
  TOOL_OUTPUT_FAILED: CardStageDurationSchema.optional(),
  INITIALIZE_SLOW: CardStageDurationSchema.optional(),
  INITIALIZE_FAILED: CardStageDurationSchema.optional()
}).strict();

export const ProductCardTelemetryInputSchema = z.object({
  renderId: z.string().uuid(),
  version: z.literal(FINDCHEAP_VERSION),
  terminalStage: z.enum([
    "DOM_RENDERED",
    "FIRST_IMAGE_SETTLED",
    "TOOL_OUTPUT_TIMEOUT",
    "TOOL_OUTPUT_FAILED",
    "INITIALIZE_SLOW"
  ]),
  stages: ProductCardStagesSchema
}).strict();

export type ProductCardTelemetry = z.infer<typeof ProductCardTelemetryInputSchema> & {
  recordedAt: string;
};

export type ProductCardTelemetrySink = {
  record(event: ProductCardTelemetry): void | Promise<void>;
};
