import { afterEach, describe, it, expect, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS, CommandRouter } from "./CommandRouter.js";
import { Prompt } from "@orbit-build/tui";
import type { AgentLoopRunOutcome } from "@orbit-build/core";

describe("CommandRouter Unit Tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("includes the Orbit Web UI command in built-in slash commands", () => {
    expect(BUILTIN_SLASH_COMMANDS).toContain("/webui");
  });

  it("serializes terminal turns while a Web UI turn owns the agent loop", async () => {
    let finishWebRun: (() => void) | undefined;
    const loop = {
      ...mockLoop,
      prepareUserTurn: vi.fn(),
      getSessionId: () => "session-web",
      run: vi.fn(
        () =>
          new Promise<AgentLoopRunOutcome>((resolve) => {
            finishWebRun = () =>
              resolve({
                status: "completed",
                sessionId: "session-web",
                attempts: 1,
              });
          }),
      ),
    };
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      setActiveRunnable: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const submitWebPrompt = (
      router as unknown as {
        submitWebPrompt(prompt: string): Promise<{ ok: boolean }>;
      }
    ).submitWebPrompt.bind(router);

    const pendingWebTurn = submitWebPrompt("long browser task");
    await vi.waitFor(() => expect(loop.run).toHaveBeenCalledOnce());

    expect(router.isWebUiBusy()).toBe(true);
    expect(router.beginTerminalRun()).toBeUndefined();

    finishWebRun?.();
    await expect(pendingWebTurn).resolves.toEqual({ ok: true });

    const releaseTerminalRun = router.beginTerminalRun();
    expect(releaseTerminalRun).toBeTypeOf("function");
    releaseTerminalRun?.();
  });

  it("returns structured agent failures to the Web UI", async () => {
    const loop = {
      ...mockLoop,
      prepareUserTurn: vi.fn(),
      getSessionId: () => "session-failed",
      run: vi.fn(
        async (): Promise<AgentLoopRunOutcome> => ({
          status: "failed",
          sessionId: "session-failed",
          attempts: 1,
          error: {
            code: "provider_error",
            message: "Provider rejected the request.",
          },
        }),
      ),
    };
    const tui = {
      ...mockTui,
      hasActiveRunnable: vi.fn(() => false),
      setActiveRunnable: vi.fn(),
      finishAttempt: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );
    const result = await (
      router as unknown as {
        submitWebPrompt(prompt: string): Promise<{
          ok: boolean;
          message?: string;
        }>;
      }
    ).submitWebPrompt("request with a bad credential");

    expect(result).toEqual({
      ok: false,
      message: "Provider rejected the request.",
    });
    expect(router.isWebUiBusy()).toBe(false);
  });

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
      false,
    );

    const result = await router.route("/help");
    expect(result.processed).toBe(true);
    expect(result.shouldExit).toBe(false);
    // useFullscreenTui=false → printOutput → console.log (TUI not active)
    expect(result.processed).toBe(true);
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
      false,
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
      false,
    );

    const result = await router.route("/invalidcommand");
    expect(result.processed).toBe(true);
    expect(result.shouldExit).toBe(false);
  });

  it("routes command output through fullscreen TUI when active", async () => {
    const addSystemMessage = vi.fn();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const tui = {
      ...mockTui,
      isActive: true,
      addSystemMessage,
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      mockLoop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/exit");

    expect(result).toEqual({ shouldExit: true, processed: true });
    expect(addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining("Exiting"),
      false,
    );
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("keeps the /chat picker open after deleting a session", async () => {
    let sessions = [
      {
        id: "session-1",
        title: "First",
        createdAt: "2026-06-28T01:00:00.000Z",
        model: "deepseek-v4-flash",
      },
      {
        id: "session-2",
        title: "Second",
        createdAt: "2026-06-28T02:00:00.000Z",
        model: "deepseek-v4-flash",
      },
    ];
    const deleteSession = vi.fn((id: string) => {
      sessions = sessions.filter((session) => session.id !== id);
    });
    const askSelectWithDelete = vi
      .spyOn(Prompt, "askSelectWithDelete")
      .mockResolvedValueOnce({ action: "delete", value: "session-1" })
      .mockResolvedValueOnce({ action: "delete", value: "session-2" });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const loop = {
      ...mockLoop,
      state: { sessionId: "active-session" },
      sessionManager: {
        getActiveSession: () => ({ id: "active-session" }),
      },
      getSessions: vi.fn(() => sessions),
      getSessionId: vi.fn(() => "active-session"),
      deleteSession,
      startNewSession: vi.fn(),
      resumeSession: vi.fn(),
    };
    const tui = {
      ...mockTui,
      isActive: false,
      loadHistory: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      false,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/chat");

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(deleteSession).toHaveBeenNthCalledWith(1, "session-1");
    expect(deleteSession).toHaveBeenNthCalledWith(2, "session-2");
    expect(askSelectWithDelete).toHaveBeenCalledTimes(2);
    expect(askSelectWithDelete.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "session-1" }),
        expect.objectContaining({ value: "session-2" }),
      ]),
    );
    expect(askSelectWithDelete.mock.calls[1][1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "session-2" })]),
    );
    expect(askSelectWithDelete.mock.calls[1][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "session-1" })]),
    );
    expect(askSelectWithDelete.mock.calls[1][2]).toEqual(
      expect.objectContaining({ initialSelectedValue: "session-2" }),
    );
  });

  it("silently reloads history after deleting the active session in fullscreen", async () => {
    let sessions = [
      {
        id: "session-1",
        title: "First",
        createdAt: "2026-06-28T01:00:00.000Z",
        model: "deepseek-v4-flash",
      },
      {
        id: "session-2",
        title: "Second",
        createdAt: "2026-06-28T02:00:00.000Z",
        model: "deepseek-v4-flash",
      },
    ];
    const reloadedHistory = [
      {
        role: "user",
        content: [{ type: "text", text: "still here" }],
      },
    ];
    const deleteSession = vi.fn((id: string) => {
      sessions = sessions.filter((session) => session.id !== id);
    });
    const askSelectWithDelete = vi
      .spyOn(Prompt, "askSelectWithDelete")
      .mockResolvedValueOnce({ action: "delete", value: "session-1" })
      .mockResolvedValueOnce({ action: "cancel" });
    const sessionState = { sessionId: "session-1" };
    const loop = {
      ...mockLoop,
      state: sessionState,
      sessionManager: {
        getActiveSession: () => ({ id: "session-1" }),
      },
      getSessions: vi.fn(() => sessions),
      getSessionId: vi.fn(() => sessionState.sessionId),
      getHistory: vi.fn(() => reloadedHistory),
      deleteSession,
      startNewSession: vi.fn(),
      resumeSession: vi.fn((id: string) => {
        sessionState.sessionId = id;
        return true;
      }),
    };
    const tui = {
      ...mockTui,
      isActive: true,
      loadHistory: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const router = new CommandRouter(
      "/dummy/cwd",
      mockConfig,
      mockProvider,
      vi.fn(),
      loop as any,
      tui as any,
      true,
      () => ({ commands: [], files: [], symbols: [], sessions: [] }),
      vi.fn(),
      () => localState,
      vi.fn(),
      mockInteraction as any,
      false,
    );

    const result = await router.route("/chat");

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(deleteSession).toHaveBeenCalledWith("session-1");
    expect(loop.resumeSession).toHaveBeenCalledWith("session-2");
    expect(tui.loadHistory).toHaveBeenCalledWith(reloadedHistory, {
      silent: true,
    });
    expect(askSelectWithDelete.mock.calls[0][2]).toEqual(
      expect.objectContaining({ suppressCloseRenderOnDelete: true }),
    );
  });
});
