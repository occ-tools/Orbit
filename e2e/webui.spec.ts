import { expect, test } from "@playwright/test";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { eventBus } from "../packages/core/dist/index.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
  type WebUiHandle,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";

let handle: WebUiHandle;
let submittedPrompts: string[];
let sessionActions: string[];

test.beforeEach(async () => {
  submittedPrompts = [];
  sessionActions = [];
  handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    port: 0,
    open: false,
    loop: {
      getHistory: () => [
        {
          id: "assistant-welcome",
          role: "assistant",
          createdAt: "2026-07-19T00:00:00.000Z",
          metadata: { model: "deepseek-v4-flash" },
          content: [{ type: "text", text: "Browser runtime ready." }],
        },
      ],
      getSessions: () => [],
      getRelevantFiles: () => [],
      getSessionId: () => "e2e-session",
    },
    submitPrompt: async (prompt) => {
      submittedPrompts.push(prompt);
      return { ok: true };
    },
    updateSession: async (action) => {
      sessionActions.push(action.action);
      return { ok: true };
    },
  });
});

test.afterEach(async () => {
  await stopOrbitWebUi();
});

test("connects, chats, streams, and keeps the assistant mark aligned", async ({
  page,
}) => {
  await page.goto(handle.url);

  await expect(page.getByTestId("orbit-app")).toBeVisible();
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.getByText("Browser runtime ready.")).toBeVisible();

  const avatar = await page.locator(".message-avatar").first().boundingBox();
  const role = await page.locator(".message-role").first().boundingBox();
  expect(avatar).not.toBeNull();
  expect(role).not.toBeNull();
  expect(Math.abs((avatar?.y ?? 0) - (role?.y ?? 0))).toBeLessThanOrEqual(2);

  await page.getByTestId("composer-input").fill("inspect this project");
  await page.getByTestId("composer-send").click();
  await expect.poll(() => submittedPrompts).toEqual(["inspect this project"]);
  await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);

  expect(eventBus.listenerCount("*")).toBeGreaterThan(0);
  eventBus.emitEvent("ui_turn_started", {
    turnId: "browser-stream-turn",
    source: "terminal",
    prompt: "stream from terminal",
  });
  eventBus.emitEvent("model_delta", { text: "Synchronized stream output" });
  await expect(page.getByText("Synchronized stream output")).toBeVisible();
});

test("creates chats and remains responsive without horizontal overflow", async ({
  page,
}) => {
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);

  await page.getByTestId("new-chat").click();
  await expect.poll(() => sessionActions).toContain("new");

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  }
});
