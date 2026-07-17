import { ConfigSchema } from "@orbit-build/config";
import { describe, expect, it } from "vitest";
import {
  collectWebUiApproval,
  collectWebUiMessages,
  collectWebUiSettings,
  collectWebUiStatus,
  filterWebUiCompletionFiles,
  summarizeWebUiContextFiles,
} from "./WebUiData.js";

describe("WebUiData", () => {
  it("redacts and bounds pending browser approvals", () => {
    expect(
      collectWebUiApproval({
        id: "approval-123",
        kind: "change",
        title: "Review src/index.ts",
        reason: "Bearer private-token-value",
        preview: "+ token=private-token-value\n- old line",
        requestedAt: "2026-07-17T00:00:00.000Z",
      }),
    ).toMatchObject({
      id: "approval-123",
      kind: "change",
      reason: "Bearer ***REDACTED***",
    });
    expect(
      collectWebUiApproval({ id: "bad", kind: "invalid" }),
    ).toBeUndefined();
  });

  it("ranks safe workspace file completions and rejects traversal paths", () => {
    expect(
      filterWebUiCompletionFiles(
        [
          "packages/cli/src/index.ts",
          "src/index.ts",
          "README.md",
          "../outside.txt",
          "C:/outside.txt",
          "src\\runtime\\indexer.ts",
          "src/index.ts",
        ],
        "index",
      ),
    ).toEqual([
      "src/index.ts",
      "src/runtime/indexer.ts",
      "packages/cli/src/index.ts",
    ]);

    expect(
      filterWebUiCompletionFiles(["src/deep/file.ts", "README.md"], ""),
    ).toEqual(["README.md", "src/deep/file.ts"]);
  });

  it("summarizes active context without exposing unsafe or duplicate paths", () => {
    expect(
      summarizeWebUiContextFiles(
        [
          { path: "src\\index.ts", readOnly: false },
          { path: "./docs/README.md", readOnly: true },
          { path: "src/index.ts", readOnly: true },
          { path: "../outside.txt" },
          { path: "C:/outside.txt" },
          { path: "bad\ncommand.ts" },
        ],
        1,
      ),
    ).toEqual({
      files: [{ path: "src/index.ts", readOnly: false }],
      total: 2,
      truncated: true,
    });
  });

  it("filters internal context and narrows message blocks", () => {
    const messages = collectWebUiMessages({
      getHistory: () => [
        { role: "system", content: "private system prompt" },
        {
          role: "user",
          metadata: { kind: "orbit_volatile_context" },
          content: "private context",
        },
        {
          id: "visible",
          role: "assistant",
          content: [
            { type: "thinking", text: "checking" },
            { type: "text", text: "done" },
            {
              type: "tool_result",
              toolResult: { name: "read_file", isError: false },
            },
          ],
        },
      ],
    });

    expect(messages).toEqual([
      {
        id: "visible",
        role: "assistant",
        createdAt: undefined,
        text: "done",
        blocks: [
          { type: "thinking", text: "checking" },
          { type: "text", text: "done" },
          {
            type: "tool",
            id: "",
            name: "read_file",
            status: "success",
          },
        ],
      },
    ]);
  });

  it("merges tool results into credential-safe invocation summaries", () => {
    const messages = collectWebUiMessages({
      getHistory: () => [
        {
          id: "assistant-tool",
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCall: {
                id: "tool-1",
                name: "read_file",
                arguments: JSON.stringify({
                  path: "src/index.ts",
                  content: "must not be exposed",
                  apiKey: "private-token",
                }),
              },
            },
          ],
        },
        {
          id: "tool-result",
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolResult: {
                toolCallId: "tool-1",
                name: "read_file",
                content: "private file contents",
                isError: false,
              },
            },
          ],
        },
        {
          id: "assistant-final",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: "assistant-tool",
        blocks: [
          {
            type: "tool",
            id: "tool-1",
            name: "read_file",
            status: "success",
            detail: "path: src/index.ts",
          },
          { type: "text", text: "done" },
        ],
        text: "done",
      }),
    ]);
    expect(JSON.stringify(messages)).not.toMatch(
      /must not be exposed|private-token|private file contents/,
    );
  });

  it("places the live model override first and removes duplicates", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          models: ["deepseek-v4-pro", "deepseek-v4-flash"],
        },
      },
    });
    const settings = collectWebUiSettings({
      cwd: "D:/repo",
      config,
      loop: { getModelOverride: () => "deepseek-v4-pro" },
    });

    expect(settings.model).toBe("deepseek-v4-pro");
    expect(settings.modelOptions[0]?.id).toBe("deepseek-v4-pro");
    expect(
      settings.modelOptions.filter(({ id }) => id === "deepseek-v4-pro"),
    ).toHaveLength(1);
  });

  it("reports model-aware context usage without exposing prompt data", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: { "deepseek-openai": { type: "openai-compatible" } },
    });
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: {
          getContextWindowStatus: () => ({
            model: "deepseek-v4-pro",
            maxContextTokens: 128_000,
            compactAtTokens: 96_000,
            estimatedHistoryTokens: 24_000,
            utilization: 0.1875,
          }),
        },
      },
      undefined,
    );

    expect(status.context).toMatchObject({
      model: "deepseek-v4-pro",
      maxContextTokens: 128_000,
      compactAtTokens: 96_000,
      estimatedHistoryTokens: 24_000,
      utilization: 0.1875,
    });
  });

  it("returns a bounded, active-first recent-session navigation model", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: { "deepseek-openai": { type: "openai-compatible" } },
    });
    const status = collectWebUiStatus(
      {
        cwd: "D:/repo",
        config,
        loop: {
          getSessionId: () => "sess-active",
          getSessions: () => [
            {
              id: "sess-older",
              title: "Older task",
              model: "deepseek-v4-flash",
              updatedAt: "2026-07-15T12:00:00.000Z",
            },
            {
              id: "sess-active",
              title: "Fix Bearer private-secret-value",
              model: "deepseek-v4-pro",
              updatedAt: "2026-07-15T11:00:00.000Z",
            },
          ],
        },
      },
      undefined,
    );

    expect(status.session.recent).toEqual([
      expect.objectContaining({
        id: "sess-active",
        active: true,
        title: "Fix Bearer ***REDACTED***",
      }),
      expect.objectContaining({ id: "sess-older", active: false }),
    ]);
  });
});
