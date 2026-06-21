import { describe, it, expect, vi } from "vitest";
import { ReplController } from "./ReplController.js";

describe("ReplController Instantiation and Completer Tests", () => {
  const mockConfig = {
    language: "en",
    permissions: { mode: "strict" },
    models: { default: "gpt-4", planner: "planner-model", coder: "coder-model", reviewer: "reviewer-model", fast: "fast-model" },
    autocomplete: { enabled: false },
    session: { store: "jsonl", path: ".orbit/test-sessions" },
  };

  const mockProvider = {
    id: "openai",
    chat: vi.fn(),
  };

  const mockInteraction = {
    askApproval: vi.fn(),
    showText: vi.fn(),
    showDiff: vi.fn(),
  };

  it("should instantiate ReplController successfully", () => {
    const controller = new ReplController(
      process.cwd(),
      mockConfig,
      mockProvider,
      mockInteraction as any,
      false,
      true
    );
    expect(controller).toBeDefined();
    expect(controller.start).toBeDefined();
  });
});
