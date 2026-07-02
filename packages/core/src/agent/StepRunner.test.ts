import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StepRunner } from "./StepRunner.js";
import { toolRegistry } from "@orbit-build/tools";

describe("StepRunner Subprocess Timestamps & Limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should abort tool execution using the configured command timeout", async () => {
    // Mock the registry get to return a dummy execution tool that hangs
    const mockTool = {
      name: "bash",
      description: "mock bash",
      inputSchema: {
        safeParse: () => ({ success: true, data: {} }),
      },
      execute: async (args: any, ctx: any) => {
        return new Promise((resolve, reject) => {
          ctx.abortSignal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    };

    vi.spyOn(toolRegistry, "get").mockReturnValue(mockTool as any);

    const runner = new StepRunner(process.cwd(), "test-session", {
      tools: { bash: { timeoutMs: 3000 } },
    } as any);

    const runPromise = runner.run({
      id: "call_1",
      name: "bash",
      arguments: "{}",
    });

    vi.advanceTimersByTime(3000);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 3000ms");
  });

  it("caps requested bash timeout to the configured maximum", async () => {
    const mockTool = {
      name: "bash",
      description: "mock bash",
      inputSchema: {
        safeParse: (args: any) => ({ success: true, data: args }),
      },
      execute: async (_args: any, ctx: any) => {
        return new Promise((resolve, reject) => {
          ctx.abortSignal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    };

    vi.spyOn(toolRegistry, "get").mockReturnValue(mockTool as any);

    const runner = new StepRunner(process.cwd(), "test-session", {
      tools: { bash: { timeoutMs: 5000 } },
    } as any);

    const runPromise = runner.run({
      id: "call_1",
      name: "bash",
      arguments: JSON.stringify({ command: "sleep", timeoutMs: 60000 }),
    });

    vi.advanceTimersByTime(5000);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 5000ms");
  });
});
