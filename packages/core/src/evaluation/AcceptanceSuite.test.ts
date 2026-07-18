import { describe, expect, it } from "vitest";
import {
  AcceptanceSuiteSchema,
  scoreAcceptanceTask,
} from "./AcceptanceSuite.js";

describe("acceptance suite", () => {
  const task = AcceptanceSuiteSchema.parse({
    schemaVersion: 1,
    name: "DeepSeek coding acceptance",
    tasks: [
      {
        id: "repair-build",
        prompt: "Repair the failing build.",
        requiredChangedFiles: ["src/**/*.ts"],
        forbiddenChangedFiles: [".env*", "package-lock.json"],
        maxChangedFiles: 4,
        verification: [{ name: "tests", command: "pnpm test" }],
      },
    ],
  }).tasks[0];

  it("passes only from agent, file, and verification evidence", () => {
    const result = scoreAcceptanceTask({
      task,
      agentStatus: "completed",
      durationMs: 1234.5,
      changedFiles: ["src/runtime/fix.ts"],
      checks: [
        {
          name: "tests",
          passed: true,
          durationMs: 120,
          exitCode: 0,
          summary: "passed",
        },
      ],
      resolvedModels: ["deepseek-v4-pro", "deepseek-v4-pro"],
    });

    expect(result).toMatchObject({
      passed: true,
      durationMs: 1235,
      resolvedModels: ["deepseek-v4-pro"],
    });
  });

  it("reports every independent failure reason", () => {
    const result = scoreAcceptanceTask({
      task,
      agentStatus: "failed",
      durationMs: 10,
      changedFiles: [".env.local", "docs/a.md"],
      checks: [
        {
          name: "tests",
          passed: false,
          durationMs: 4,
          exitCode: 1,
          summary: "failed",
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        "agent_failed",
        "required_file_missing:src/**/*.ts",
        "forbidden_file_changed:.env.local",
        "verification_failed:tests",
      ]),
    );
  });
});
