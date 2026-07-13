import { z } from "zod";

const SafeObjectKeySchema = z
  .string()
  .refine(
    (key) => !["__proto__", "constructor", "prototype"].includes(key),
    "Unsafe object key.",
  );

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Validates values that can be persisted as JSON without lossy coercion. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(SafeObjectKeySchema, JsonValueSchema),
  ]),
);

/** Validates text that contains a safe JSON value. */
export const JsonTextSchema = z.string().superRefine((value, context) => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (JsonValueSchema.safeParse(parsed).success) return;
  } catch {
    // Report a single stable issue below.
  }
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Expected valid, safe JSON text.",
  });
});

export const SessionIdSchema = z
  .string()
  .regex(/^sess_[a-z]+-[a-z]+-\d{3}$/, "Invalid Orbit session id.");

export const SessionSchema = z.object({
  id: SessionIdSchema,
  cwd: z.string().min(1),
  title: z.string(),
  status: z.enum(["active", "completed", "failed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provider: z.string().min(1),
  model: z.string().min(1),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCostEstimate: z.number().finite().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export const SessionEventSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  type: z.string().min(1),
  payload: JsonValueSchema,
  createdAt: z.string().datetime(),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;

const StoredToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: JsonTextSchema,
});

const StoredToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  content: z.string(),
  isError: z.boolean().optional(),
});

export const StoredContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("tool_call"), toolCall: StoredToolCallSchema }),
  z.object({
    type: z.literal("tool_result"),
    toolResult: StoredToolResultSchema,
  }),
  z.object({
    type: z.literal("thinking"),
    text: z.string(),
    signature: z.string().optional(),
  }),
]);

export const StoredHistoryMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.array(StoredContentBlockSchema),
  createdAt: z.string().datetime(),
  metadata: z.record(SafeObjectKeySchema, JsonValueSchema).optional(),
});

export const StoredHistorySchema = z.array(StoredHistoryMessageSchema);
export type StoredHistoryMessage = z.infer<typeof StoredHistoryMessageSchema>;

export const ToolCallRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  toolName: z.string().min(1),
  inputJson: JsonTextSchema,
  outputJson: JsonTextSchema.optional(),
  risk: z.string().min(1),
  permissionDecision: z.string().min(1),
  status: z.enum(["pending", "success", "failed", "denied"]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const FileChangeRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: SessionIdSchema,
  path: z.string().min(1),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
  diff: z.string(),
  createdAt: z.string().datetime(),
});

export type FileChangeRecord = z.infer<typeof FileChangeRecordSchema>;
