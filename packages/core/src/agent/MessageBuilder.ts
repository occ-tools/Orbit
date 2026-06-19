import { OrbitMessage } from "@orbit-ai/model-providers";
import { ContextPack } from "@orbit-ai/context-engine";
import { AgentState } from "./AgentState.js";

export class MessageBuilder {
  public static build(
    systemPrompt: string,
    state: AgentState,
    contextPack: ContextPack,
  ): { system: string; messages: OrbitMessage[] } {
    const fullSystem = [
      systemPrompt,
      "\n### Workspace Context",
      `Language profile: ${contextPack.projectIndex.detectedLanguages.join(", ")}`,
      `Framework profile: ${contextPack.projectIndex.frameworks.join(", ") || "None"}`,
      `Entrypoints: ${contextPack.projectIndex.entrypoints.join(", ") || "None"}`,
      `PM: ${contextPack.projectIndex.packageManager || "None"}`,
      contextPack.projectInstructions
        ? `\nInstructions from ORBIT.md:\n${contextPack.projectInstructions}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const filesContent = contextPack.relevantFiles
      .map((f) => {
        return `File: ${f.path}\nReason: ${f.reason}\nSummary: ${f.summary}\n\`\`\`\n${f.excerpt}\n\`\`\``;
      })
      .join("\n\n");

    // Find the user message that initiated the current turn (the last user message in state.history)
    let lastUserMsgIdx = -1;
    for (let i = state.history.length - 1; i >= 0; i--) {
      if (state.history[i].role === "user") {
        lastUserMsgIdx = i;
        break;
      }
    }

    if (lastUserMsgIdx === -1) {
      // Fallback: prepend a user message with the request and context
      const fallbackUserMsg: OrbitMessage = {
        id: "msg_fallback_user",
        role: "user",
        createdAt: new Date().toISOString(),
        content: [
          {
            type: "text",
            text: [
              `### Current User Request:\n\n${state.task}`,
              contextPack.codebaseContext
                ? `### Codebase Context:\n\n${contextPack.codebaseContext}`
                : "",
              `### Relevant Files Excerpts:\n\n${filesContent || "No files indexed yet."}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      };
      return {
        system: fullSystem,
        messages: [fallbackUserMsg, ...state.history],
      };
    }

    const messages = state.history.map((msg, idx) => {
      if (idx === lastUserMsgIdx) {
        const userText =
          (msg.metadata?.rawText as string) ||
          msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

        const combinedText = [
          `### Current User Request:\n\n${userText}`,
          contextPack.codebaseContext
            ? `### Codebase Context:\n\n${contextPack.codebaseContext}`
            : "",
          `### Relevant Files Excerpts:\n\n${filesContent || "No files indexed yet."}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        // Save rawText in metadata so we can retrieve it in subsequent steps of the same turn
        if (!msg.metadata) {
          msg.metadata = {};
        }
        if (!msg.metadata.rawText) {
          msg.metadata.rawText = userText;
        }

        // Persist the decorated text back into the history message itself
        msg.content = [
          {
            type: "text" as const,
            text: combinedText,
          },
        ];
      }
      return msg;
    });

    return {
      system: fullSystem,
      messages,
    };
  }
}
