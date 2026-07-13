import { ConfigSchema } from "@orbit-build/config";
import { describe, expect, it } from "vitest";
import { collectWebUiMessages, collectWebUiSettings } from "./WebUiData.js";

describe("WebUiData", () => {
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
          { type: "tool", name: "read_file", status: "success" },
        ],
      },
    ]);
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
});
