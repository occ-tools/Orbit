import { z } from "zod";

export const AgentStartEventSchema = z.object({
  type: z.literal("agent_start"),
  payload: z.object({
    taskId: z.string(),
    task: z.string(),
  }),
});

export const LoopStartEventSchema = z.object({
  type: z.literal("loop_start"),
  payload: z.object({
    attempt: z.number(),
  }),
});

export const ModelDeltaEventSchema = z.object({
  type: z.literal("model_delta"),
  payload: z.object({
    text: z.string(),
  }),
});

export const ThinkingDeltaEventSchema = z.object({
  type: z.literal("thinking_delta"),
  payload: z.object({
    text: z.string(),
  }),
});

export const CostUpdateEventSchema = z.object({
  type: z.literal("cost_update"),
  payload: z.object({
    turnCost: z.number(),
    sessionCost: z.number(),
    totalInputTokens: z.number(),
    totalCacheReadTokens: z.number(),
    totalOutputTokens: z.number(),
  }),
});

export const InfoEventSchema = z.object({
  type: z.literal("info"),
  payload: z.object({
    message: z.string(),
  }),
});

export const OrbitEventSchema = z.discriminatedUnion("type", [
  AgentStartEventSchema,
  LoopStartEventSchema,
  ModelDeltaEventSchema,
  ThinkingDeltaEventSchema,
  CostUpdateEventSchema,
  InfoEventSchema,
]);

export type OrbitEvent = z.infer<typeof OrbitEventSchema>;
