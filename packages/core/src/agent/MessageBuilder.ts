import { OrbitMessage } from "@orbit-build/model-providers";
import { ContextPack } from "@orbit-build/context-engine";
import { AgentState } from "./AgentState.js";

export class MessageBuilder {
  public static build(
    systemPrompt: string,
    state: AgentState,
    contextPack: ContextPack,
  ): { system: string; messages: OrbitMessage[] } {
    const dynamicContextStr = this.buildVolatileContext(contextPack);

    const system = `${systemPrompt}\n${dynamicContextStr}`;

    return {
      system,
      messages: [...state.history],
    };
  }

  public static buildVolatileContext(contextPack: ContextPack): string {
    const filesByPath = new Map<
      string,
      {
        path: string;
        reasons: Set<string>;
        summary?: string;
        excerpt?: string;
        readOnly?: boolean;
      }
    >();

    for (const file of contextPack.relevantFiles) {
      const existing = filesByPath.get(file.path);
      if (existing) {
        existing.reasons.add(file.reason);
        existing.readOnly ||= file.readOnly;
        existing.summary ||= file.summary;
        existing.excerpt ||= file.excerpt;
      } else {
        filesByPath.set(file.path, {
          path: file.path,
          reasons: new Set([file.reason]),
          summary: file.summary,
          excerpt: file.excerpt,
          readOnly: file.readOnly,
        });
      }
    }

    const sortedFiles = [...filesByPath.values()].sort((a, b) => {
      if (a.readOnly !== b.readOnly) return a.readOnly ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    const filesContent = sortedFiles
      .map((f) => {
        const readOnlySuffix = f.readOnly
          ? " (READ-ONLY REFERENCE - DO NOT EDIT OR CALL WRITE TOOLS ON THIS FILE)"
          : "";
        const reason = [...f.reasons].sort().join("; ");
        return [
          `File: ${this.normalizeContextText(f.path)}${readOnlySuffix}`,
          `Reason: ${this.normalizeContextText(reason)}`,
          `Summary: ${this.normalizeContextText(f.summary || "")}`,
          "```",
          this.normalizeContextText(f.excerpt || ""),
          "```",
        ].join("\n");
      })
      .join("\n\n");

    const dynamicContextParts = [
      "### Volatile Context",
      `\n### Context Instructions:\n- You are strictly prohibited from calling any tools (like write_file, edit_file) to modify any files marked as "READ-ONLY REFERENCE". Those files are for your reference only.`,
      `\n### Relevant Files Excerpts:\n\n${filesContent || "No files indexed yet."}`,
      contextPack.codebaseContext
        ? `\n### Codebase Context:\n\n${this.normalizeContextText(contextPack.codebaseContext)}`
        : "",
    ];

    return dynamicContextParts.filter(Boolean).join("\n");
  }

  private static normalizeContextText(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
}
