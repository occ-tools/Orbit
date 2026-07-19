import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { resolveSafePath } from "@orbit-build/shared";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const WriteFileInputSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  content: z.string().max(5_000_000),
});

export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export class WriteFileTool implements OrbitTool<WriteFileInput, void> {
  name = "write_file";
  description =
    "Write complete content to a file inside the project. Automatically creates parent folders if they do not exist.";
  inputSchema = WriteFileInputSchema;
  risk = "write" as const;

  async execute(
    input: WriteFileInput,
    ctx: ToolContext,
  ): Promise<ToolResult<void>> {
    try {
      const safePath = resolveSafePath(ctx.cwd, input.path);
      mkdirSync(dirname(safePath), { recursive: true });
      writeFileSync(safePath, input.content, "utf8");

      return {
        ok: true,
        display: `Wrote file to ${input.path}`,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
