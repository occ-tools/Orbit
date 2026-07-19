import { z } from "zod";
import glob from "fast-glob";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const GlobInputSchema = z.object({
  pattern: z.string().min(1).max(4096),
  maxResults: z.number().int().min(1).max(5000).optional(),
});

export type GlobInput = z.infer<typeof GlobInputSchema>;

export class GlobTool implements OrbitTool<GlobInput, string[]> {
  name = "glob";
  description =
    "Find files matching a glob pattern inside the project workspace, with a configurable bounded result count.";
  inputSchema = GlobInputSchema;
  risk = "read" as const;

  async execute(
    input: GlobInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string[]>> {
    try {
      const files = await glob(input.pattern, {
        cwd: ctx.cwd,
        ignore: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
        ],
        onlyFiles: true,
        dot: true,
        suppressErrors: true,
      });

      const maxResults = input.maxResults ?? 500;
      const boundedFiles = files.slice(0, maxResults);
      return {
        ok: true,
        data: boundedFiles,
        display: `Glob matches for "${input.pattern}": returned ${boundedFiles.length}${files.length > boundedFiles.length ? ` of ${files.length}` : ""} files`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
