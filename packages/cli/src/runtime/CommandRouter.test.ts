import { describe, it, expect, vi } from "vitest";
import { CommandRouter } from "./CommandRouter.js";

describe("CommandRouter Unit Tests", () => {
  const mockConfig = {
    language: "en",
    permissions: { mode: "strict" },
    models: { default: "gpt-4" },
  };

  const mockProvider = {
    id: "openai",
    chat: vi.fn(),
  };

  const mockLoop = {
    getConfig: () => mockConfig,
    getModelOverride: () => undefined,
    getHistory: () => [],
    getCheckpoints: () => [],
    getRelevantFiles: () => [],
    addRelevantFilePublic: vi.fn(),
  };

  const mockTui = {
    isActive: true,
    addSystemMessage: vi.fn(),
    addLog: vi.fn(),
    syncFromLoop: vi.fn(),
    setCandidates: vi.fn(),
  };

  const mockInteraction = {
    askApproval: vi.fn(),
    showText: vi.fn(),
    showDiff: vi.fn(),
  };

  const localState = { lastSessionId: "123", lastModel: "gpt-4" };

  it("should output help message when /help is executed", async () => {
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false
    );

    const result = await router.route("/help");
    expect(result.processed).toBe(true);
    expect(result.shouldExit).toBe(false);
    expect(mockTui.addSystemMessage).toHaveBeenCalled();
  });

  it("should return processed: false for non-slash command inputs", async () => {
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false
    );

    const result = await router.route("create a login page");
    expect(result.processed).toBe(false);
    expect(result.shouldExit).toBe(false);
  });

  it("should output error message for unknown command", async () => {
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      mockTui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false
    );

    const result = await router.route("/invalidcommand");
    expect(result.processed).toBe(true);
    expect(result.shouldExit).toBe(false);
  });
});
