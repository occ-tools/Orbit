import { describe, it, expect } from "vitest";
import { MessageBuilder } from "./MessageBuilder.js";
import { AgentState, createInitialState } from "./AgentState.js";
import { ContextPack } from "@orbit-ai/context-engine";

describe("MessageBuilder prompt caching", () => {
  it("should decorate user message once and leave it unchanged on subsequent builds", () => {
    const state = createInitialState("session-123", "fix the bug");
    state.history = [
      {
        id: "msg-1",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: "fix the bug" }],
      },
    ];

    const context1: ContextPack = {
      projectIndex: {
        detectedLanguages: ["typescript"],
        frameworks: ["vitest"],
        entrypoints: [],
        packageManager: "pnpm",
        files: {},
      },
      projectInstructions: "Use spaces.",
      relevantFiles: [
        {
          path: "src/index.ts",
          reason: "entrypoint",
          summary: "entry point file",
          excerpt: "console.log('hello');",
        },
      ],
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      codebaseContext: "RAG context A",
      tokenBudget: { max: 128000, usedEstimate: 100 },
    };

    // First call: should decorate message
    const build1 = MessageBuilder.build("System Prompt", state, context1);
    const text1 = build1.messages[0].content[0].text;
    expect(text1).toContain("RAG context A");
    expect(text1).toContain("console.log('hello');");
    expect(build1.messages[0].metadata?.rawText).toBe("fix the bug");

    // Modify context pack for subsequent step
    const context2: ContextPack = {
      ...context1,
      codebaseContext: "RAG context B",
      relevantFiles: [
        {
          path: "src/index.ts",
          reason: "entrypoint",
          summary: "entry point file",
          excerpt: "console.log('hello modified');",
        },
      ],
    };

    // Second call: should NOT re-decorate because rawText metadata is set
    const build2 = MessageBuilder.build("System Prompt", state, context2);
    const text2 = build2.messages[0].content[0].text;
    expect(text2).toBe(text1); // Should remain completely identical to the first build output
    expect(text2).not.toContain("RAG context B");
    expect(text2).not.toContain("hello modified");
  });
});
