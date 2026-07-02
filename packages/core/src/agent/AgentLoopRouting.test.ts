import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentLoop } from "./AgentLoop.js";
import { OrbitConfig } from "@orbit-build/config";
import { ModelProvider } from "@orbit-build/model-providers";
import { toolRegistry } from "@orbit-build/tools";
import { Prompt } from "@orbit-build/tui";
import { z } from "zod";
import fs from "fs";
import path from "path";

describe("AgentLoop Fin Heuristic Routing", () => {
  const testDir = path.resolve(process.cwd(), "routing-test-temp");

  const dummyConfig: OrbitConfig = {
    name: "test",
    provider: { default: "openai" },
    models: {
      default: "deepseek-v4-pro",
      fast: "deepseek-v4-flash",
    },
    providers: { openai: { type: "openai", apiKey: "test" } },
    permissions: {
      mode: "auto",
      allowRead: true,
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
      protectedPaths: [],
    },
    context: {
      maxFilesToIndex: 10,
      maxFileSizeKb: 10,
      ignore: [],
      autoCompact: false,
      compactThreshold: 0.75,
    },
    tools: {
      bash: { enabled: false, timeoutMs: 1000 },
      webSearch: { enabled: false },
      mcp: { enabled: false },
    },
    mcpServers: {},
    hooks: {},
    session: { store: "jsonl", path: ".orbit/test-sessions" },
  };

  const dummyInteraction = {
    askApproval: async () => true,
    showText: () => {},
    showDiff: () => {},
  };

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    delete process.env.ORBIT_DEEPSEEK_CACHE_PRIMER_BUDGET_MS;
    vi.useRealTimers();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should route to default reasoning model and set high thinking budget on complex keywords", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield {
        type: "text_delta",
        text: "Response",
      };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
    } as any;

    const loop = new AgentLoop(
      testDir,
      dummyConfig,
      mockProvider,
      "please debug the compilation error in parser.ts",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalled();
    const callArgs = chatMock.mock.calls[0][0];
    expect(callArgs.model).toBe("deepseek-v4-pro");
    expect(callArgs.thinking).toEqual({ enabled: true, budgetTokens: 4096 });
  });

  it("should route to fast model on simple query", async () => {
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield {
        type: "text_delta",
        text: "Response",
      };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
    } as any;

    const loop = new AgentLoop(
      testDir,
      dummyConfig,
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalled();
    const callArgs = chatMock.mock.calls[0][0];
    expect(callArgs.model).toBe("deepseek-v4-flash");
    // Since it's deepseek-v4-flash (which doesn't contain "reasoner" or "r1" or "v4-pro"), thinking should be undefined
    expect(callArgs.thinking).toBeUndefined();
  });

  it("should apply configured agent loop iteration limit", () => {
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: vi.fn(),
    } as any;

    const loop = new AgentLoop(
      testDir,
      {
        ...dummyConfig,
        agent: { maxIterations: 12 },
      } as any,
      mockProvider,
      "search current weather",
      dummyInteraction,
      { disableStatusBar: true },
    );

    expect((loop as any).state.maxAttempts).toBe(12);
  });

  it("summarizes aggressively compacted history instead of replaying old turns", () => {
    const mockProvider: ModelProvider = {
      id: "openai",
      chat: vi.fn(),
    } as any;

    const loop = new AgentLoop(
      testDir,
      dummyConfig,
      mockProvider,
      "continue",
      dummyInteraction,
      { disableStatusBar: true },
    );

    const summary = (loop as any).buildCompactionSummary([
      {
        id: "old-user",
        role: "user",
        createdAt: "2026-07-01T00:00:00.000Z",
        content: [{ type: "text", text: "请全面优化 TUI 删除体验" }],
      },
      {
        id: "old-assistant",
        role: "assistant",
        createdAt: "2026-07-01T00:00:01.000Z",
        content: [
          {
            type: "tool_call",
            toolCall: {
              id: "edit-1",
              name: "edit_file",
              arguments: "{}",
            },
          },
        ],
      },
      {
        id: "old-tool",
        role: "tool",
        createdAt: "2026-07-01T00:00:02.000Z",
        content: [
          {
            type: "tool_result",
            toolResult: {
              id: "edit-1",
              name: "edit_file",
              content: "ok",
              isError: false,
            },
          },
        ],
      },
    ]);

    expect(summary).toContain("[Conversation Summary]");
    expect(summary).toContain("tool_call:edit_file");
    expect(summary).toContain("tool_result:edit_file:ok");
    expect(summary.length).toBeLessThan(700);
  });

  it("should ask only once for repeated web search approval in one run", async () => {
    const originalWebSearch = toolRegistry.get("web_search");
    const executeWebSearch = vi.fn(async (input: any) => ({
      ok: true,
      data: `result for ${input.query}`,
      display: `mock search for ${input.query}`,
    }));
    toolRegistry.register({
      name: "web_search",
      description: "mock web search",
      inputSchema: z.object({ query: z.string() }),
      risk: "network",
      execute: executeWebSearch,
    });
    const askApproval = vi.spyOn(Prompt, "askApproval").mockResolvedValue(true);
    const askSelect = vi.spyOn(Prompt, "askSelect");

    let callCount = 0;
    const chatMock = vi.fn().mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "search-1",
            name: "web_search",
            arguments: JSON.stringify({ query: "杭州 2026-06-29 天气" }),
          },
        };
        return;
      }
      if (callCount === 2) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "search-2",
            name: "web_search",
            arguments: JSON.stringify({ query: "杭州 2026-06-29 气温" }),
          },
        };
        return;
      }
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    try {
      const loop = new AgentLoop(
        testDir,
        {
          ...dummyConfig,
          permissions: { ...dummyConfig.permissions, mode: "normal" },
          tools: {
            ...dummyConfig.tools,
            webSearch: { enabled: true },
          },
          agent: { maxIterations: 8 },
        } as any,
        mockProvider,
        "查杭州 2026-06-29 天气",
        dummyInteraction,
        { disableStatusBar: true },
      );

      await loop.run();

      expect(executeWebSearch).toHaveBeenCalledTimes(2);
      expect(askApproval).toHaveBeenCalledTimes(1);
      expect(askSelect).not.toHaveBeenCalledWith(
        expect.stringContaining('Confirm execution of tool "web_search"'),
        expect.anything(),
      );
    } finally {
      if (originalWebSearch) {
        toolRegistry.register(originalWebSearch);
      }
      askApproval.mockRestore();
      askSelect.mockRestore();
    }
  });

  it("compacts live lookup tool results before replaying them to the model", async () => {
    const originalWebSearch = toolRegistry.get("web_search");
    const longSummary = "杭州天气实时资料 ".repeat(80);
    const rawResults = Array.from({ length: 15 }, (_, index) =>
      [
        `[${index + 1}] Title: Weather Result ${index + 1}`,
        `    Link: https://example.com/weather/${index + 1}`,
        `    Summary: ${longSummary}${index + 1}`,
      ].join("\n"),
    ).join("\n\n");

    toolRegistry.register({
      name: "web_search",
      description: "mock web search",
      inputSchema: z.object({ query: z.string() }),
      risk: "network",
      execute: vi.fn(async () => ({
        ok: true,
        data: rawResults,
        display: "Web search returned 15 results via Mock.",
      })),
    });

    const askApproval = vi.spyOn(Prompt, "askApproval").mockResolvedValue(true);
    let callCount = 0;
    let replayedMessages: any[] = [];
    const chatMock = vi.fn().mockImplementation(async function* (input: any) {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          toolCall: {
            id: "search-compact",
            name: "web_search",
            arguments: JSON.stringify({ query: "杭州天气" }),
          },
        };
        return;
      }

      replayedMessages = input.messages;
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
    } as any;

    try {
      const loop = new AgentLoop(
        testDir,
        {
          ...dummyConfig,
          permissions: { ...dummyConfig.permissions, mode: "normal" },
          tools: {
            ...dummyConfig.tools,
            webSearch: { enabled: true },
          },
        } as any,
        mockProvider,
        "查杭州天气",
        dummyInteraction,
        { disableStatusBar: true },
      );

      await loop.run();

      const toolMessage = replayedMessages.find((msg) => msg.role === "tool");
      const toolResult = toolMessage?.content?.[0]?.toolResult;
      expect(toolResult?.content).toContain(
        "Results kept for reasoning: 10/15",
      );
      expect(toolResult?.content).toContain("Weather Result 10");
      expect(toolResult?.content).not.toContain("Weather Result 15");
      expect(toolResult?.content.length).toBeLessThan(rawResults.length);
    } finally {
      if (originalWebSearch) {
        toolRegistry.register(originalWebSearch);
      }
      askApproval.mockRestore();
    }
  });

  it("includes tool parameter descriptions in the XML fallback prompt", async () => {
    const originalWebSearch = toolRegistry.get("web_search");
    toolRegistry.register({
      name: "web_search",
      description: "mock live lookup",
      inputSchema: z.object({
        query: z.string().describe("Search query with runtime dates."),
        maxResults: z
          .number()
          .describe("Maximum number of search results.")
          .optional(),
      }),
      risk: "network",
      execute: vi.fn(),
    });

    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "text_delta", text: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "openai",
      chat: chatMock,
    } as any;

    try {
      const loop = new AgentLoop(
        testDir,
        {
          ...dummyConfig,
          tools: {
            ...dummyConfig.tools,
            webSearch: { enabled: true },
          },
        } as any,
        mockProvider,
        "search current docs",
        dummyInteraction,
        { disableStatusBar: true, allowedTools: ["web_search"] },
      );

      await loop.run();

      const system = chatMock.mock.calls[0][0].system;
      expect(system).toContain("`query`: (type: string)");
      expect(system).toContain("Search query with runtime dates");
      expect(system).toContain("`maxResults`: (type: number, optional)");
      expect(system).toContain("Maximum number of search results");
    } finally {
      if (originalWebSearch) {
        toolRegistry.register(originalWebSearch);
      }
    }
  });

  it("should prime DeepSeek cache slab before the main request", async () => {
    const chatMock = vi.fn().mockImplementation(async function* (input: any) {
      if (input.maxTokens === 1) {
        yield {
          type: "usage",
          usage: {
            inputTokens: 100,
            outputTokens: 1,
            totalTokens: 101,
            cacheReadTokens: 0,
            cacheMissTokens: 100,
          },
        };
        return;
      }
      yield {
        type: "text_delta",
        text: "Response",
      };
      yield {
        type: "usage",
        usage: {
          inputTokens: 120,
          outputTokens: 5,
          totalTokens: 125,
          cacheReadTokens: 80,
          cacheMissTokens: 40,
        },
      };
    });

    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = new AgentLoop(
      testDir,
      {
        ...dummyConfig,
        provider: { default: "deepseek-openai" },
      },
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalledTimes(3);
    const firstPrimerArgs = chatMock.mock.calls[0][0];
    const secondPrimerArgs = chatMock.mock.calls[1][0];
    const mainArgs = chatMock.mock.calls[2][0];
    expect(firstPrimerArgs.maxTokens).toBe(1);
    expect(secondPrimerArgs.maxTokens).toBe(1);
    expect(firstPrimerArgs.system).toContain("<!-- VOLATILE_CONTEXT -->");
    expect(mainArgs.system.startsWith(firstPrimerArgs.system)).toBe(true);
    expect(mainArgs.system).toContain("### Volatile Context");
  });

  it("should prime cache for self-hosted DeepSeek models by model name", async () => {
    const chatMock = vi.fn().mockImplementation(async function* (input: any) {
      if (input.maxTokens === 1) {
        yield {
          type: "usage",
          usage: {
            inputTokens: 100,
            outputTokens: 1,
            totalTokens: 101,
            cacheReadTokens: 0,
            cacheMissTokens: 100,
          },
        };
        return;
      }
      yield {
        type: "text_delta",
        text: "Response",
      };
    });

    const mockProvider: ModelProvider = {
      id: "local-openai-compatible",
      type: "openai-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = new AgentLoop(
      testDir,
      {
        ...dummyConfig,
        provider: { default: "local-deepseek" },
        models: {
          default: "vendor/deepseek-v4-flash",
          fast: "vendor/deepseek-v4-flash",
        },
        providers: {
          "local-deepseek": {
            type: "openai-compatible",
            baseUrl: "http://localhost:8000/v1",
          },
        },
      },
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(chatMock.mock.calls[0][0].maxTokens).toBe(1);
    expect(chatMock.mock.calls[1][0].maxTokens).toBe(1);
    expect(chatMock.mock.calls[2][0].model).toBe("vendor/deepseek-v4-flash");
  });

  it("keeps DeepSeek cache alive with the stable slab only", async () => {
    vi.useFakeTimers();
    const chatMock = vi.fn().mockImplementation(async function* () {
      yield { type: "done" };
    });

    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = new AgentLoop(
      testDir,
      {
        ...dummyConfig,
        provider: { default: "deepseek-openai" },
      },
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    (loop as any).lastChatParams = {
      model: "deepseek-v4-flash",
      system: "stable slab\n<!-- VOLATILE_CONTEXT -->",
    };
    (loop as any).startKeepaliveTimer();

    await vi.advanceTimersByTimeAsync(210000);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const keepaliveArgs = chatMock.mock.calls[0][0];
    expect(keepaliveArgs.system).toBe("stable slab\n<!-- VOLATILE_CONTEXT -->");
    expect(keepaliveArgs.messages).toHaveLength(1);
    expect(keepaliveArgs.messages[0].content[0].text).toBe("0");
    expect(keepaliveArgs.tools).toEqual([]);
    expect(keepaliveArgs.stream).toBe(false);
    expect(keepaliveArgs.maxTokens).toBe(1);

    (loop as any).stopKeepaliveTimer();
  });

  it("does not block Flash main request when cache primer exceeds latency budget", async () => {
    process.env.ORBIT_DEEPSEEK_CACHE_PRIMER_BUDGET_MS = "1";
    const callOrder: string[] = [];
    const chatMock = vi.fn().mockImplementation(async function* (input: any) {
      if (input.maxTokens === 1) {
        callOrder.push("primer");
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield {
          type: "usage",
          usage: {
            inputTokens: 100,
            outputTokens: 1,
            totalTokens: 101,
            cacheReadTokens: 0,
            cacheMissTokens: 100,
          },
        };
        return;
      }

      callOrder.push("main");
      yield {
        type: "text_delta",
        text: "Response",
      };
    });

    const mockProvider: ModelProvider = {
      id: "deepseek-openai",
      type: "openai-compatible",
      chat: chatMock,
      getModelCapabilities: () => ({
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      }),
    } as any;

    const loop = new AgentLoop(
      testDir,
      {
        ...dummyConfig,
        provider: { default: "deepseek-openai" },
      },
      mockProvider,
      "what is this project?",
      dummyInteraction,
      { disableStatusBar: true },
    );

    await loop.run();

    expect(callOrder[0]).toBe("primer");
    expect(callOrder[1]).toBe("main");
    expect(chatMock.mock.calls[1][0].maxTokens).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(chatMock.mock.calls[2][0].maxTokens).toBe(1);
  });
});
