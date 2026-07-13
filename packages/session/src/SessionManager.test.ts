import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { SessionManager } from "./SessionManager.js";
import { ToolCallRecordSchema } from "./types.js";

const StoredToolInputSchema = z.object({
  id: z.string(),
  arguments: z.string(),
  authorization: z.string(),
  self: z.string(),
});

const StoredToolOutputSchema = z.object({
  password: z.string(),
  apiKey: z.string(),
  outputTokens: z.number(),
  rawKey: z.string(),
});

describe("SessionManager audit persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "orbit-session-manager-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("redacts structured, nested, and free-form credentials", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");
    const standardKey = `sk-${"a".repeat(32)}`;
    const input: Record<string, unknown> = {
      id: "tc_safe",
      arguments: JSON.stringify({
        apiKey: "plain-nested-key",
        maxTokens: 64,
      }),
      authorization: "Bearer top-secret-token",
    };
    input.self = input;

    manager.recordToolExecution(
      "shell",
      input,
      {
        password: "plain-password",
        apiKey: "plain-api-key",
        outputTokens: 42,
        rawKey: standardKey,
      },
      "write",
      "allow",
      "success",
    );
    manager.recordFileModification(
      "src/config.ts",
      `+ API_KEY=plain-file-key\n+ key=${standardKey}`,
    );
    manager.logEvent("credential_test", {
      password: "plain-event-password",
      inputTokens: 12,
    });

    const sessionDir = join(tempDir, ".orbit", "sessions", session.id);
    const toolLog = readFileSync(join(sessionDir, "tool_calls.jsonl"), "utf8");
    expect(toolLog).not.toContain("plain-nested-key");
    expect(toolLog).not.toContain("top-secret-token");
    expect(toolLog).not.toContain("plain-password");
    expect(toolLog).not.toContain("plain-api-key");
    expect(toolLog).not.toContain(standardKey);

    const record = ToolCallRecordSchema.parse(
      JSON.parse(toolLog.trim()) as unknown,
    );
    expect(record.id).toBe("tc_safe");
    const storedInput = StoredToolInputSchema.parse(
      JSON.parse(record.inputJson) as unknown,
    );
    expect(storedInput.authorization).toBe("[REDACTED]");
    expect(storedInput.self).toBe("[Circular]");
    expect(
      z
        .object({ apiKey: z.string(), maxTokens: z.number() })
        .parse(JSON.parse(storedInput.arguments) as unknown),
    ).toEqual({ apiKey: "[REDACTED]", maxTokens: 64 });

    const storedOutput = StoredToolOutputSchema.parse(
      JSON.parse(record.outputJson ?? "null") as unknown,
    );
    expect(storedOutput).toEqual({
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      outputTokens: 42,
      rawKey: "sk-***REDACTED***",
    });

    const fileLog = readFileSync(
      join(sessionDir, "file_changes.jsonl"),
      "utf8",
    );
    expect(fileLog).not.toContain("plain-file-key");
    expect(fileLog).not.toContain(standardKey);
    expect(fileLog).toContain("[REDACTED]");

    const credentialEvent = manager
      .getSessionStore()
      .getEvents(session.id)
      .find((event) => event.type === "credential_test");
    expect(credentialEvent?.payload).toEqual({
      password: "[REDACTED]",
      inputTokens: 12,
    });
  });

  it("handles hostile tool inputs without losing the audit record", () => {
    const manager = new SessionManager(tempDir);
    const session = manager.startNewSession("deepseek", "deepseek-v4-flash");
    const hostileInput = new Proxy(
      {},
      {
        has: () => {
          throw new Error("hostile proxy");
        },
        ownKeys: () => {
          throw new Error("hostile proxy");
        },
      },
    );

    expect(() =>
      manager.recordToolExecution(
        "shell",
        hostileInput,
        undefined,
        "read",
        "allow",
        "success",
      ),
    ).not.toThrow();

    const toolLog = readFileSync(
      join(tempDir, ".orbit", "sessions", session.id, "tool_calls.jsonl"),
      "utf8",
    );
    const record = ToolCallRecordSchema.parse(
      JSON.parse(toolLog.trim()) as unknown,
    );
    expect(record.id).toBe("tc_unknown");
    expect(JSON.parse(record.inputJson) as unknown).toBe(
      "[Unserializable object]",
    );
    expect(JSON.parse(record.outputJson ?? "null") as unknown).toBe(
      "[Undefined]",
    );
  });
});
