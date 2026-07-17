import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConfigSchema } from "@orbit-build/config";
import {
  parseWebUiArgs,
  resolveBrowserLaunch,
  startOrbitWebUi,
  stopOrbitWebUi,
} from "./WebUiServer.js";
import { WEB_UI_CLIENT_SCRIPT } from "./WebUiClient.js";
import { renderWebUiPage } from "./WebUiPage.js";
import { sanitizeWebEventPayload } from "./WebUiSecurity.js";
import { WEB_UI_STYLES } from "./WebUiStyles.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {
    throw new Error("Deferred promise was not initialized.");
  };
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function collectSseEvents(response: Response): {
  events: Array<Record<string, unknown>>;
  close(): Promise<void>;
} {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response has no readable body.");
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  const reading = (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data) events.push(JSON.parse(data) as Record<string, unknown>);
        boundary = buffer.indexOf("\n\n");
      }
    }
  })().catch(() => undefined);

  return {
    events,
    close: async () => {
      await reader.cancel().catch(() => undefined);
      await reading;
    },
  };
}

async function readSseEvent(
  response: Response,
  expectedKind: string,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response has no readable body.");
  const decoder = new TextDecoder();
  let buffer = "";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Timed out waiting for SSE.")),
      2_000,
    );
  });

  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timedOut]);
      if (chunk.done) throw new Error("SSE stream ended unexpectedly.");
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data) {
          const event = JSON.parse(data) as Record<string, unknown>;
          if (event.kind === expectedKind) return event;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
}

describe("WebUiServer", () => {
  afterEach(async () => {
    await stopOrbitWebUi();
  });

  it("parses port and open flags", () => {
    expect(parseWebUiArgs("6060 --no-open")).toEqual({
      port: 6060,
      open: false,
    });
    expect(parseWebUiArgs("--port=0")).toEqual({ port: 0, open: true });
    expect(parseWebUiArgs("--port 6080")).toEqual({
      port: 6080,
      open: true,
    });
  });

  it("launches browsers without routing URLs through a command shell", () => {
    const url = "http://127.0.0.1:6060/#token=value&unsafe=%26calc";
    expect(resolveBrowserLaunch(url, "win32")).toEqual({
      command: "explorer.exe",
      args: [url],
    });
    expect(resolveBrowserLaunch(url, "darwin")).toEqual({
      command: "open",
      args: [url],
    });
    expect(resolveBrowserLaunch(url, "linux")).toEqual({
      command: "xdg-open",
      args: [url],
    });
  });

  it("ships valid standalone client assets and localized markup", () => {
    expect(() => new Function(WEB_UI_CLIENT_SCRIPT)).not.toThrow();
    expect(WEB_UI_STYLES).toContain("100dvh");
    expect(WEB_UI_STYLES).toContain("prefers-reduced-motion");
    const localizedPage = renderWebUiPage("zh");
    expect(localizedPage).toContain('lang="zh"');
    expect(localizedPage).toContain("接下来想做什么？");
    expect(localizedPage).toContain('class="orbit-mark brand-mark"');
    expect(localizedPage).toContain('class="orbit-cat-head"');
    expect(localizedPage).toContain(
      'id="sidebarCollapseButton" type="button" aria-label="收起导航"',
    );
    expect(localizedPage).toContain(
      'id="recentSessions" aria-label="最近任务"',
    );
    expect(localizedPage).toContain(
      'rel="icon" type="image/svg+xml" href="/assets/orbit-mark.svg"',
    );
    expect(localizedPage).toContain('id="emptyComposerSlot"');
    expect(localizedPage).toContain('id="contextPicker"');
    expect(localizedPage).toContain('id="contextSearch"');
    expect(localizedPage).toContain('id="contextShelf"');
    expect(localizedPage).toContain('id="contextFileList"');
    expect(localizedPage).toContain('id="clearContextButton"');
    expect(localizedPage).toContain('aria-controls="contextResults"');
    expect(localizedPage).toContain("搜索工作区文件…");
    expect(localizedPage).toContain('id="connectionHelp"');
    expect(localizedPage.indexOf('id="connectionHelp"')).toBeLessThan(
      localizedPage.indexOf('id="conversation"'),
    );
    expect(localizedPage).toContain("页面会自动重连");
    expect(localizedPage).toContain("autofocus");
    expect(localizedPage).not.toContain('class="orbit-companion"');
    expect(localizedPage).toContain('id="inspector"');
    expect(localizedPage).toContain('id="inspectorBackdrop"');
    expect(localizedPage).toContain('aria-modal="true"');
    expect(localizedPage).toContain('id="commandPalette"');
    expect(localizedPage).toContain(
      'aria-label="命令帮助" aria-haspopup="dialog"',
    );
    expect(localizedPage).toContain('aria-labelledby="commandPaletteTitle"');
    expect(localizedPage).toContain('aria-label="搜索操作…"');
    expect(localizedPage).toContain('aria-controls="commandResults"');
    expect(localizedPage).toContain('aria-autocomplete="list"');
    expect(localizedPage).toContain("需要时使用已配置的搜索工具。");
    expect(localizedPage).toContain('id="searchDependencies"');
    expect(localizedPage).toContain('class="switch-track" aria-hidden="true"');
    expect(localizedPage).toContain('aria-label="联网"');
    expect(localizedPage).toContain('data-mode="normal" aria-pressed="false"');
    expect(localizedPage).toContain(
      'data-theme-value="system" aria-pressed="false"',
    );
    expect(localizedPage).toContain(
      'id="settingsTab" type="button" role="tab" aria-selected="false" aria-controls="settingsPanel" tabindex="-1"',
    );
    expect(localizedPage).toContain('<option value="normal">标准</option>');
    expect(localizedPage).toContain('aria-label="滚动到最新消息"');
    expect(localizedPage).toContain('class="ui-icon"');
    const englishPage = renderWebUiPage("en");
    expect(englishPage).toContain(
      'aria-label="Commands" aria-haspopup="dialog"',
    );
    expect(englishPage).toContain('aria-label="Search actions…"');
    expect(localizedPage).toContain('id="contextMeter"');
    expect(localizedPage).toContain('aria-hidden="true"');
    expect(localizedPage).toContain('tabindex="-1" inert');
    expect(WEB_UI_CLIENT_SCRIPT).toContain("ensureStreamingTurn(event.turnId)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("void reconcileStatus()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("state.eventRetryAttempt");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("Math.min(8000");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.events.querySelector('.activity-row')",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.sidebar.inert = sidebarHidden",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("elements.inspector.inert = !open");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("sidebarReturnFocus.focus()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("elements.inspectorClose.focus()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("returnTarget.focus()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.appShell.classList.toggle('is-busy', busy)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.composerAnchor.before(elements.composerDock)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "aborted ? 'warning' : failed ? 'error' : 'success'",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("command === '/doctor'");
  });

  it("serves authenticated workspace file completions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-files-"));
    mkdirSync(join(cwd, "src", "runtime"), { recursive: true });
    mkdirSync(join(cwd, "node_modules", "private"), { recursive: true });
    writeFileSync(join(cwd, "src", "index.ts"), "export {};\n");
    writeFileSync(join(cwd, "src", "runtime", "indexer.ts"), "export {};\n");
    writeFileSync(join(cwd, "node_modules", "private", "index.ts"), "hidden\n");

    try {
      const handle = await startOrbitWebUi({
        cwd,
        port: 0,
        open: false,
        config: ConfigSchema.parse({}),
      });
      const url = new URL(handle.url);
      const token = new URLSearchParams(url.hash.slice(1)).get("token");
      const endpoint = `${url.origin}/api/completions?query=index`;

      const unauthorized = await fetch(endpoint);
      expect(unauthorized.status).toBe(401);

      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        files: ["src/index.ts", "src/runtime/indexer.ts"],
        total: 2,
      });

      const invalid = await fetch(
        `${url.origin}/api/completions?query=${"x".repeat(201)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(invalid.status).toBe(400);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allowlists and redacts events before sending them to browsers", () => {
    expect(
      sanitizeWebEventPayload("tool_proposal", {
        toolCallId: "tool-1",
        toolName: "bash",
        arguments: { token: "sk-abcdefghijklmnopqrstuvwxyz1234567890" },
        explanation: "run a check",
      }),
    ).toEqual({
      toolCallId: "tool-1",
      toolName: "bash",
      explanation: "run a check",
    });
    expect(
      sanitizeWebEventPayload("error", {
        message: "Bearer sensitive-token-value",
        stack: "private stack",
      }),
    ).toEqual({ message: "Bearer ***REDACTED***" });
    expect(
      sanitizeWebEventPayload("agent_completed", {
        result: { private: true },
      }),
    ).toBeUndefined();
  });

  it("serves the Orbit graphical page and status API", async () => {
    const submitted: string[] = [];
    const patches: unknown[] = [];
    const sessionActions: unknown[] = [];
    const approvalDecisions: unknown[] = [];
    const handle = await startOrbitWebUi({
      cwd: "D:/repo",
      port: 0,
      open: false,
      config: ConfigSchema.parse({
        provider: { default: "deepseek-openai" },
        providers: {
          "deepseek-openai": {
            type: "openai-compatible",
            baseUrl:
              "https://api-user:api-password@api.deepseek.com/v1?api_key=query-secret#Bearer-sensitive-token",
          },
        },
        models: {
          default: "deepseek-v4-flash",
          fast: "deepseek-v4-flash",
          planner: "deepseek-v4-pro",
          coder: "deepseek-v4-pro",
        },
        permissions: {
          mode: "normal",
          protectedPaths: ["private-permission-marker"],
        },
        tools: {
          webSearch: {
            enabled: true,
            provider: "auto",
            maxResults: 8,
            searxngUrls: [
              "https://search-user:search-password@example.invalid/?token=search-secret",
            ],
            tavilyApiKeyEnv: "PRIVATE_TAVILY_KEY",
            tavilyBaseUrl:
              "https://tavily-user:tavily-password@example.invalid/?key=tavily-secret",
          },
          mcp: { enabled: false },
        },
        skills: {
          enabled: true,
          directories: ["https://skill-user:skill-password@example.invalid"],
        },
        context: { maxFilesToIndex: 5000, compactThreshold: 0.75 },
      }),
      loop: {
        getSessionId: () => "sess-test",
        getSessions: () => [{ id: "sess-test" }],
        getHistory: () => [
          {
            id: "msg-1",
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
          {
            id: "msg-internal",
            role: "user",
            metadata: { kind: "orbit_volatile_context" },
            content: [{ type: "text", text: "private RAG context" }],
          },
          {
            id: "msg-2",
            role: "assistant",
            content: [
              { type: "thinking", text: "checking" },
              { type: "text", text: "done" },
              {
                type: "tool_call",
                toolCall: { id: "tool-1", name: "read_file" },
              },
            ],
          },
          {
            id: "msg-3",
            role: "tool",
            content: [
              {
                type: "tool_result",
                toolResult: {
                  toolCallId: "tool-1",
                  name: "read_file",
                  content: "sensitive file contents are not serialized",
                  isError: false,
                },
              },
            ],
          },
        ],
        getRelevantFiles: () => [{ path: "src/index.ts" }],
      },
      submitPrompt: async (prompt) => {
        submitted.push(prompt);
        return { ok: true };
      },
      updateSettings: async (patch) => {
        patches.push(patch);
        return { ok: true };
      },
      updateSession: async (action) => {
        sessionActions.push(action);
        return { ok: true };
      },
      getPendingApproval: () => ({
        id: "approval-12345678",
        kind: "tool",
        title: "Allow bash?",
        reason: "Bearer private-approval-token",
        preview: "pnpm test",
        requestedAt: "2026-07-17T00:00:00.000Z",
      }),
      respondToApproval: async (decision) => {
        approvalDecisions.push(decision);
        return { ok: decision.id === "approval-12345678" };
      },
    });
    const handleUrl = new URL(handle.url);
    const token = new URLSearchParams(handleUrl.hash.slice(1)).get("token");
    const baseUrl = `${handleUrl.origin}/`;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const htmlResponse = await fetch(handle.url);
    const rootCookie = htmlResponse.headers.get("set-cookie") || "";
    const html = await htmlResponse.text();
    const css = await fetch(`${baseUrl}assets/orbit.css`).then((response) =>
      response.text(),
    );
    const script = await fetch(`${baseUrl}assets/orbit.js`).then((response) =>
      response.text(),
    );
    const faviconResponse = await fetch(`${baseUrl}assets/orbit-mark.svg`);
    const favicon = await faviconResponse.text();
    const status = await fetch(`${baseUrl}api/status`, {
      headers: authHeaders,
    }).then((response) => response.json());
    const messages = await fetch(`${baseUrl}api/messages`, {
      headers: authHeaders,
    }).then((response) => response.json());
    const approval = await fetch(`${baseUrl}api/approval`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "approval-12345678", approved: true }),
    }).then((response) => response.json());
    const chat = await fetch(`${baseUrl}api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi from web" }),
    }).then((response) => response.json());
    const settings = await fetch(`${baseUrl}api/settings`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        permissionMode: "auto",
        webSearchEnabled: false,
        webSearchProvider: "bing",
        webSearchMaxResults: 12,
      }),
    }).then((response) => response.json());
    const session = await fetch(`${baseUrl}api/session`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume", sessionId: "sess-test" }),
    }).then((response) => response.json());

    expect(html).toContain('class="app-shell"');
    expect(html).toContain('id="emptyState"');
    expect(html).toContain("/assets/orbit.css");
    expect(html).toContain("/assets/orbit.js");
    expect(html).not.toContain("<style>");
    expect(html).not.toContain("<script>");
    expect(css).toContain(".composer-dock");
    expect(css).toContain("prefers-reduced-motion");
    expect(script).toContain("/api/chat");
    expect(script).toContain("/api/cancel");
    expect(script).toContain("/api/session");
    expect(faviconResponse.headers.get("content-type")).toContain(
      "image/svg+xml",
    );
    expect(favicon).toContain("<svg");
    expect(favicon).toContain("#d97972");
    expect(script).toContain("/api/approval");
    expect(html).toContain('id="approvalPanel"');
    expect(script).toContain("history.replaceState");
    expect(htmlResponse.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(htmlResponse.headers.get("content-security-policy")).not.toContain(
      "unsafe-inline",
    );
    expect(rootCookie).toContain("orbit_web_token=");
    expect(rootCookie).toContain("HttpOnly");
    expect(rootCookie).toContain("SameSite=Strict");
    expect(status.workspace).toBe("D:/repo");
    expect(status.provider.id).toBe("deepseek-openai");
    expect(status.provider.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(status.permissions).toEqual({ mode: "normal" });
    expect(status.approval).toMatchObject({
      id: "approval-12345678",
      kind: "tool",
      reason: "Bearer ***REDACTED***",
    });
    expect(status.tools.webSearch).toEqual({
      enabled: true,
      provider: "auto",
      maxResults: 8,
    });
    expect(status.skills).toEqual({ enabled: true });
    expect(JSON.stringify(status)).not.toMatch(
      /api-password|query-secret|Bearer-sensitive-token|search-secret|tavily-secret|skill-password|private-permission-marker/,
    );
    expect(status.session.activeId).toBe("sess-test");
    expect(status.session.recent).toEqual([
      expect.objectContaining({ id: "sess-test", active: true }),
    ]);
    expect(status.session.historyMessages).toBe(2);
    expect(status.context.relevantFiles).toBe(1);
    expect(status.context.files).toEqual([
      { path: "src/index.ts", readOnly: false },
    ]);
    expect(status.context.filesTruncated).toBe(false);
    expect(approval).toEqual({ ok: true });
    expect(approvalDecisions).toEqual([
      { id: "approval-12345678", approved: true },
    ]);
    expect(
      status.modelOptions.map((item: { id: string }) => item.id),
    ).toContain("deepseek-v4-flash");
    expect(messages.messages[0].text).toBe("hello");
    expect(
      messages.messages.some(
        (message: { text: string }) => message.text === "private RAG context",
      ),
    ).toBe(false);
    expect(messages.messages[1].blocks).toEqual([
      { type: "thinking", text: "checking" },
      { type: "text", text: "done" },
      {
        type: "tool",
        id: "tool-1",
        name: "read_file",
        status: "success",
      },
    ]);
    expect(messages.messages).toHaveLength(2);
    expect(chat.ok).toBe(true);
    expect(chat.turnId).toEqual(expect.any(String));
    expect(submitted).toEqual(["hi from web"]);
    expect(settings.ok).toBe(true);
    expect(patches).toEqual([
      {
        model: "deepseek-v4-pro",
        permissionMode: "auto",
        webSearchEnabled: false,
        webSearchProvider: "bing",
        webSearchMaxResults: 12,
      },
    ]);
    expect(session.ok).toBe(true);
    expect(sessionActions).toEqual([
      { action: "resume", sessionId: "sess-test" },
    ]);

    const unauthorized = await fetch(`${baseUrl}api/status`);
    expect(unauthorized.status).toBe(401);
    const rootCookieStatus = await fetch(`${baseUrl}api/status`, {
      headers: { Cookie: rootCookie.split(";", 1)[0] },
    });
    expect(rootCookieStatus.status).toBe(200);

    const bootstrap = await fetch(`${baseUrl}api/bootstrap`, {
      method: "POST",
      headers: authHeaders,
    });
    const cookie = bootstrap.headers.get("set-cookie") || "";
    expect(bootstrap.status).toBe(200);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const cookieStatus = await fetch(`${baseUrl}api/status`, {
      headers: { Cookie: cookie.split(";", 1)[0] },
    });
    expect(cookieStatus.status).toBe(200);

    const crossOrigin = await fetch(`${baseUrl}api/chat`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: JSON.stringify({ prompt: "malicious" }),
    });
    expect(crossOrigin.status).toBe(401);

    const wrongContentType = await fetch(`${baseUrl}api/chat`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "text/plain" },
      body: JSON.stringify({ prompt: "malicious" }),
    });
    expect(wrongContentType.status).toBe(415);
  });

  it("rejects concurrent turns and supports cancellation", async () => {
    let finishTurn: (() => void) | undefined;
    const cancelled: string[] = [];
    const handle = await startOrbitWebUi({
      cwd: "D:/repo",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
      loop: { getSessionId: () => "sess-cancel" },
      submitPrompt: () =>
        new Promise((resolve) => {
          finishTurn = () => resolve({ ok: true });
        }),
      cancelPrompt: () => {
        cancelled.push("cancelled");
        finishTurn?.();
        return { ok: true };
      },
    });
    const handleUrl = new URL(handle.url);
    const token = new URLSearchParams(handleUrl.hash.slice(1)).get("token");
    const baseUrl = `${handleUrl.origin}/`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const first = await fetch(`${baseUrl}api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "long task", turnId: "turn_cancel_123" }),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`${baseUrl}api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "overlap" }),
    });
    expect(second.status).toBe(409);

    const settingsWhileBusy = await fetch(`${baseUrl}api/settings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ permissionMode: "auto" }),
    });
    expect(settingsWhileBusy.status).toBe(409);

    const cancel = await fetch(`${baseUrl}api/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ turnId: "turn_cancel_123" }),
    });
    expect(cancel.status).toBe(200);
    expect(cancelled).toEqual(["cancelled"]);
    await vi.waitFor(async () => {
      const status = await fetch(`${baseUrl}api/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((response) => response.json());
      expect(status.turn.active).toBe(false);
    });
  });

  it("forwards cancellation for a turn owned by another local surface", async () => {
    const cancelPrompt = vi.fn(() => ({ ok: true }));
    const handle = await startOrbitWebUi({
      cwd: "D:/repo",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
      cancelPrompt,
    });
    const handleUrl = new URL(handle.url);
    const token = new URLSearchParams(handleUrl.hash.slice(1)).get("token");
    const response = await fetch(`${handleUrl.origin}/api/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ turnId: "terminal-turn" }),
    });

    expect(response.status).toBe(200);
    expect(cancelPrompt).toHaveBeenCalledOnce();
  });

  it("redacts failed turn messages before broadcasting them", async () => {
    const handle = await startOrbitWebUi({
      cwd: "D:/repo",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
      loop: { getSessionId: () => "sess-redaction" },
      submitPrompt: async () => ({
        ok: false,
        message: "Bearer submit-prompt-secret-token",
      }),
    });
    const handleUrl = new URL(handle.url);
    const token = new URLSearchParams(handleUrl.hash.slice(1)).get("token");
    const baseUrl = `${handleUrl.origin}/`;
    const headers = { Authorization: `Bearer ${token}` };
    const events = await fetch(`${baseUrl}api/events`, { headers });
    const turnDone = readSseEvent(events, "turn_done");

    const chat = await fetch(`${baseUrl}api/chat`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "trigger a safe failure" }),
    });

    expect(chat.status).toBe(202);
    await expect(turnDone).resolves.toMatchObject({
      kind: "turn_done",
      status: "failed",
      message: "Bearer ***REDACTED***",
    });
  });

  it("keeps the event stream available when a browser cannot retain its cookie", async () => {
    const handle = await startOrbitWebUi({
      cwd: "D:/repo",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
    });
    const url = new URL(handle.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    const events = await fetch(
      `${url.origin}/api/events?access_token=${encodeURIComponent(token || "")}`,
    );

    expect(events.status).toBe(200);
    await expect(readSseEvent(events, "system")).resolves.toMatchObject({
      kind: "system",
      message: "connected",
    });
    await expect(
      fetch(`${url.origin}/api/events?access_token=wrong-token`),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("can restart after a handle is closed directly", async () => {
    const options = {
      cwd: "D:/repo",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
    };
    const first = await startOrbitWebUi(options);
    await first.close();

    const second = await startOrbitWebUi(options);

    expect(second).not.toBe(first);
    await expect(
      fetch(second.url).then((response) => response.status),
    ).resolves.toBe(200);
  });

  it("reuses a matching listener while replacing its request options", async () => {
    const first = await startOrbitWebUi({
      cwd: "D:/repo-before",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
    });
    const second = await startOrbitWebUi({
      cwd: "D:/repo-after",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
    });
    const handleUrl = new URL(second.url);
    const token = new URLSearchParams(handleUrl.hash.slice(1)).get("token");
    const status = await fetch(`${handleUrl.origin}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => response.json());

    expect(second).toBe(first);
    expect(status.workspace).toBe("D:/repo-after");
  });

  it("isolates late turn completion events from a replacement runtime", async () => {
    const turnId = "shared_turn_123";
    const firstResult = createDeferred<{ ok: boolean }>();
    const secondResult = createDeferred<{ ok: boolean }>();
    let firstPromptReturned = false;
    let secondPromptReturned = false;

    const firstHandle = await startOrbitWebUi({
      cwd: "D:/repo-a",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
      loop: { getSessionId: () => "session-a" },
      submitPrompt: async () => {
        const result = await firstResult.promise;
        firstPromptReturned = true;
        return result;
      },
    });
    const firstUrl = new URL(firstHandle.url);
    const firstToken = new URLSearchParams(firstUrl.hash.slice(1)).get("token");
    const firstChat = await fetch(`${firstUrl.origin}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firstToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "runtime A", turnId }),
    });
    expect(firstChat.status).toBe(202);

    await stopOrbitWebUi();

    const secondHandle = await startOrbitWebUi({
      cwd: "D:/repo-b",
      port: 0,
      open: false,
      config: ConfigSchema.parse({}),
      loop: { getSessionId: () => "session-b" },
      submitPrompt: async () => {
        const result = await secondResult.promise;
        secondPromptReturned = true;
        return result;
      },
    });
    const secondUrl = new URL(secondHandle.url);
    const secondToken = new URLSearchParams(secondUrl.hash.slice(1)).get(
      "token",
    );
    const secondHeaders = { Authorization: `Bearer ${secondToken}` };
    const eventResponse = await fetch(`${secondUrl.origin}/api/events`, {
      headers: secondHeaders,
    });
    const eventCollector = collectSseEvents(eventResponse);

    try {
      const secondChat = await fetch(`${secondUrl.origin}/api/chat`, {
        method: "POST",
        headers: {
          ...secondHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: "runtime B", turnId }),
      });
      expect(secondChat.status).toBe(202);
      await vi.waitFor(() => {
        expect(
          eventCollector.events.some(
            (event) => event.kind === "turn_started" && event.turnId === turnId,
          ),
        ).toBe(true);
      });

      firstResult.resolve({ ok: true });
      await vi.waitFor(() => expect(firstPromptReturned).toBe(true));
      await new Promise<void>((resolve) => setImmediate(resolve));

      const status = await fetch(`${secondUrl.origin}/api/status`, {
        headers: secondHeaders,
      }).then((response) => response.json());
      expect(status.turn).toMatchObject({ active: true, id: turnId });
      expect(
        eventCollector.events.filter((event) => event.kind === "turn_done"),
      ).toHaveLength(0);

      secondResult.resolve({ ok: true });
      await vi.waitFor(() => expect(secondPromptReturned).toBe(true));
      await vi.waitFor(() => {
        expect(
          eventCollector.events.filter((event) => event.kind === "turn_done"),
        ).toEqual([
          expect.objectContaining({
            turnId,
            sessionId: "session-b",
            status: "completed",
          }),
        ]);
      });
    } finally {
      await eventCollector.close();
    }
  });
});
