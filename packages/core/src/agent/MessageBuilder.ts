import { OrbitMessage } from "@orbit-ai/model-providers";
import { ContextPack } from "@orbit-ai/context-engine";
import { AgentState } from "./AgentState.js";

export class MessageBuilder {
  public static build(
    systemPrompt: string,
    state: AgentState,
    contextPack: ContextPack,
  ): { system: string; messages: OrbitMessage[] } {
    const sortedLanguages = [...contextPack.projectIndex.detectedLanguages].sort();
    const sortedFrameworks = [...contextPack.projectIndex.frameworks].sort();
    const sortedEntrypoints = [...contextPack.projectIndex.entrypoints].sort();

    const fullSystem = [
      systemPrompt,
      "\n### Workspace Context",
      `Language profile: ${sortedLanguages.join(", ")}`,
      `Framework profile: ${sortedFrameworks.join(", ") || "None"}`,
      `Entrypoints: ${sortedEntrypoints.join(", ") || "None"}`,
      `PM: ${contextPack.projectIndex.packageManager || "None"}`,
      contextPack.projectInstructions
        ? `\nInstructions from ORBIT.md:\n${contextPack.projectInstructions}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const sortedFiles = [...contextPack.relevantFiles].sort((a, b) => a.path.localeCompare(b.path));
    const filesContent = sortedFiles
      .map((f) => {
        const readOnlySuffix = (f as any).readOnly ? " (READ-ONLY REFERENCE - DO NOT EDIT OR CALL WRITE TOOLS ON THIS FILE)" : "";
        return `File: ${f.path}${readOnlySuffix}\nReason: ${f.reason}\nSummary: ${f.summary}\n\`\`\`\n${f.excerpt}\n\`\`\``;
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
              `### Context Instructions:\n- You are strictly prohibited from calling any tools (like write_file, edit_file) to modify any files marked as "READ-ONLY REFERENCE". Those files are for your reference only.`,
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
        if (msg.metadata?.rawText) {
          return msg;
        }

        const userText =
          msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

        const combinedText = [
          `### Current User Request:\n\n${userText}`,
          contextPack.codebaseContext
            ? `### Codebase Context:\n\n${contextPack.codebaseContext}`
            : "",
          `### Relevant Files Excerpts:\n\n${filesContent || "No files indexed yet."}`,
          `### Context Instructions:\n- You are strictly prohibited from calling any tools (like write_file, edit_file) to modify any files marked as "READ-ONLY REFERENCE". Those files are for your reference only.`,
        ]
          .filter(Boolean)
          .join("\n\n");

        // Save rawText in metadata so we can retrieve it in subsequent steps of the same turn
        if (!msg.metadata) {
          msg.metadata = {};
        }
        msg.metadata.rawText = userText;

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
