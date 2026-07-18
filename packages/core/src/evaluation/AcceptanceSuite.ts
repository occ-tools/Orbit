import { z } from "zod";

export const AcceptanceVerificationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  command: z.string().trim().min(1).max(4000),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30 * 60_000)
    .default(120_000),
});

export const AcceptanceTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  prompt: z.string().trim().min(1).max(20_000),
  mode: z.enum(["single", "multi"]).default("single"),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  verification: z.array(AcceptanceVerificationSchema).max(20).default([]),
  requiredChangedFiles: z.array(z.string().trim().min(1)).max(100).default([]),
  forbiddenChangedFiles: z.array(z.string().trim().min(1)).max(100).default([]),
  maxChangedFiles: z.number().int().min(0).max(10_000).optional(),
});

export const AcceptanceSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  tasks: z.array(AcceptanceTaskSchema).min(1).max(100),
});

export type AcceptanceTask = z.infer<typeof AcceptanceTaskSchema>;
export type AcceptanceSuite = z.infer<typeof AcceptanceSuiteSchema>;

export const AcceptanceCheckResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  summary: z.string().max(4000),
});

export type AcceptanceCheckResult = z.infer<typeof AcceptanceCheckResultSchema>;

export const AcceptanceTaskResultSchema = z.object({
  taskId: z.string(),
  sessionId: z.string().optional(),
  traceFile: z.string().optional(),
  passed: z.boolean(),
  agentStatus: z.enum(["completed", "failed", "aborted"]),
  durationMs: z.number().int().nonnegative(),
  requestedProvider: z.string().optional(),
  requestedModel: z.string().optional(),
  resolvedModels: z.array(z.string()).default([]),
  changedFiles: z.array(z.string()),
  checks: z.array(AcceptanceCheckResultSchema),
  failureReasons: z.array(z.string()),
});

export type AcceptanceTaskResult = z.infer<typeof AcceptanceTaskResultSchema>;

/** Score one isolated task from objective evidence rather than model self-report. */
export function scoreAcceptanceTask(input: {
  task: AcceptanceTask;
  agentStatus: "completed" | "failed" | "aborted";
  durationMs: number;
  changedFiles: string[];
  checks: AcceptanceCheckResult[];
  resolvedModels?: string[];
  sessionId?: string;
  traceFile?: string;
}): AcceptanceTaskResult {
  const task = AcceptanceTaskSchema.parse(input.task);
  const changedFiles = Array.from(
    new Set(input.changedFiles.map(normalizeFilePath)),
  ).sort();
  const failureReasons: string[] = [];

  if (input.agentStatus !== "completed") {
    failureReasons.push(`agent_${input.agentStatus}`);
  }
  for (const required of task.requiredChangedFiles) {
    if (!changedFiles.some((file) => matchesGlob(file, required))) {
      failureReasons.push(`required_file_missing:${required}`);
    }
  }
  for (const forbidden of task.forbiddenChangedFiles) {
    const matched = changedFiles.find((file) => matchesGlob(file, forbidden));
    if (matched) failureReasons.push(`forbidden_file_changed:${matched}`);
  }
  if (
    task.maxChangedFiles !== undefined &&
    changedFiles.length > task.maxChangedFiles
  ) {
    failureReasons.push(
      `changed_file_limit:${changedFiles.length}>${task.maxChangedFiles}`,
    );
  }
  for (const check of input.checks) {
    if (!check.passed) failureReasons.push(`verification_failed:${check.name}`);
  }

  return AcceptanceTaskResultSchema.parse({
    taskId: task.id,
    sessionId: input.sessionId,
    traceFile: input.traceFile,
    passed: failureReasons.length === 0,
    agentStatus: input.agentStatus,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    requestedProvider: task.provider,
    requestedModel: task.model,
    resolvedModels: Array.from(new Set(input.resolvedModels || [])),
    changedFiles,
    checks: input.checks,
    failureReasons,
  });
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeFilePath(pattern);
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = escaped
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${regex}$`).test(normalizeFilePath(filePath));
}
