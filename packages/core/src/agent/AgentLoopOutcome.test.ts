import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { AgentLoop, type UserInteraction } from "./AgentLoop.js";
import { Prompt } from "@orbit-build/tui";

const capabilities = {
  streaming: true,
  toolCalls: true,
  jsonMode: true,
  thinking: true,
  vision: false,
  promptCaching: true,
};

function createConfig(): OrbitConfig {
  return {
    ...DEFAULT_CONFIG,
    name: "agent-loop-outcome-test",
    provider: { default: "test-provider" },
    providers: {
      ...DEFAULT_CONFIG.providers,
      "test-provider": {
        type: "openai-compatible",
        apiKey: "test-only-key",
        baseUrl: "https://example.invalid",
      },
    },
    models: {
      ...DEFAULT_CONFIG.models,
      default: "deepseek-v4-flash",
      fast: "deepseek-v4-flash",
    },
    tools: {
      ...DEFAULT_CONFIG.tools,
      bash: { ...DEFAULT_CONFIG.tools.bash, enabled: false },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
      mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
    },
    context: {
      ...DEFAULT_CONFIG.context,
      autoCompact: false,
      maxFilesToIndex: 10,
    },
    agent: { ...DEFAULT_CONFIG.agent },
    autoCommit: false,
  };
}

describe("AgentLoop run outcome", () => {
  let cwd: string;
  let output: string[];
  let interaction: UserInteraction;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-agent-loop-outcome-"));
    output = [];
    interaction = {
      askApproval: async () => true,
      showText: (text) => output.push(text),
      showDiff: () => undefined,
    };
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns failed for a provider stream error and redacts its message", async () => {
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      yield {
        type: "error",
        error: new Error("HTTP 401 Authorization: Bearer secret-token-value"),
      };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = new AgentLoop(
      cwd,
      createConfig(),
      provider,
      "answer briefly",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "failed",
      error: {
        code: "provider_error",
        message: expect.stringContaining("HTTP 401"),
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("secret-token-value");
    expect(output.join("\n")).not.toContain("secret-token-value");
  });

  it("returns aborted immediately without calling the provider", async () => {
    const chat = vi.fn<ModelProvider["chat"]>();
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = new AgentLoop(
      cwd,
      createConfig(),
      provider,
      "answer briefly",
      interaction,
      { disableStatusBar: true },
    );
    loop.abort("immediate");

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "aborted",
      reason: "immediate",
      attempts: 0,
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it("persists partial thinking and answer content when a stream is aborted", async () => {
    const loopRef: { current: AgentLoop | null } = { current: null };
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      yield {
        type: "thinking_delta",
        text: "partial thought",
        signature: "partial-signature",
      };
      yield { type: "text_delta", text: "partial answer" };
      if (!loopRef.current) throw new Error("Agent loop was not initialized.");
      loopRef.current.abort("immediate");
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const loop = new AgentLoop(
      cwd,
      createConfig(),
      provider,
      "answer briefly",
      interaction,
      { disableStatusBar: true },
    );
    loopRef.current = loop;

    const outcome = await loop.run();
    const assistantMessages = loop
      .getHistory()
      .filter((message) => message.role === "assistant");

    expect(outcome.status).toBe("aborted");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      metadata: {
        model: "deepseek-v4-flash",
        aborted: true,
        incomplete: true,
      },
      content: [
        {
          type: "thinking",
          text: "partial thought",
          signature: "partial-signature",
        },
        { type: "text", text: "partial answer" },
      ],
    });
  });

  it("returns failed when the loop reaches its iteration limit", async () => {
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      yield {
        type: "tool_call",
        toolCall: {
          id: "call_list",
          name: "list_files",
          arguments: JSON.stringify({ path: "." }),
        },
      };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.agent.maxIterations = 1;
    const loop = new AgentLoop(
      cwd,
      config,
      provider,
      "inspect the workspace",
      interaction,
      { disableStatusBar: true },
    );

    const outcome = await loop.run();

    expect(outcome).toMatchObject({
      status: "failed",
      attempts: 1,
      error: { code: "iteration_limit" },
    });
    expect(
      loop.sessionManager.getSessionStore().getSession(loop.getSessionId())
        ?.status,
    ).toBe("failed");
  });

  it("never opens terminal prompts in non-interactive mode", async () => {
    const target = join(cwd, "generated.txt");
    let callCount = 0;
    const chat = vi.fn<ModelProvider["chat"]>(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_write",
            name: "write_file",
            arguments: JSON.stringify({ path: target, content: "ready\n" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "Done." };
    });
    const provider: ModelProvider = {
      id: "test-provider",
      type: "openai-compatible",
      capabilities,
      chat,
    };
    const config = createConfig();
    config.permissions = {
      ...config.permissions,
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
    };
    const askSelect = vi
      .spyOn(Prompt, "askSelect")
      .mockRejectedValue(new Error("Terminal prompt must not be opened."));
    const askApproval = vi
      .spyOn(Prompt, "askApproval")
      .mockRejectedValue(new Error("Terminal prompt must not be opened."));
    const loop = new AgentLoop(
      cwd,
      config,
      provider,
      "write a file",
      interaction,
      { disableStatusBar: true, nonInteractive: true },
    );

    const outcome = await loop.run();

    expect(outcome.status).toBe("completed");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("ready\n");
    expect(askSelect).not.toHaveBeenCalled();
    expect(askApproval).not.toHaveBeenCalled();
  });
});
