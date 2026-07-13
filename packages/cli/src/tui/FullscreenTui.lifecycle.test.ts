import readline from "readline";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenTui } from "./FullscreenTui.js";
import { InputHistoryStore } from "./InputHistoryStore.js";

describe("FullscreenTui lifecycle", () => {
  const originalWrite = process.stdout.write;

  afterEach(() => {
    process.stdout.write = originalWrite;
    vi.restoreAllMocks();
  });

  it("keeps construction side-effect free and initializes explicitly", () => {
    const emitKeypressEvents = vi
      .spyOn(readline, "emitKeypressEvents")
      .mockImplementation(() => {});
    const loadHistory = vi
      .spyOn(InputHistoryStore.prototype, "load")
      .mockReturnValue([]);

    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    expect(emitKeypressEvents).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
    expect(process.stdout.write).toBe(originalWrite);

    tui.initialize();
    tui.initialize();
    expect(emitKeypressEvents).toHaveBeenCalledTimes(1);
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(process.stdout.write).not.toBe(originalWrite);

    tui.dispose();
    expect(process.stdout.write).toBe(originalWrite);
  });

  it("preserves the stdout receiver while rendering an embedded prompt", async () => {
    vi.spyOn(readline, "emitKeypressEvents").mockImplementation(() => {});
    vi.spyOn(InputHistoryStore.prototype, "load").mockReturnValue([]);
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);

    const receivers: unknown[] = [];
    const receiverAwareWrite = function (this: typeof process.stdout): boolean {
      receivers.push(this);
      return true;
    } as typeof process.stdout.write;
    process.stdout.write = receiverAwareWrite;

    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    tui.initialize();
    tui.isActive = true;

    const pending = tui.showPrompt({
      type: "select",
      message: "Choose model",
      options: [{ value: "flash", label: "DeepSeek Flash" }],
    });

    expect(receivers.length).toBeGreaterThan(0);
    expect(receivers.every((receiver) => receiver === process.stdout)).toBe(
      true,
    );
    tui.dispose();
    await expect(pending).resolves.toBeNull();
  });
});
