import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { resolveSafePath } from "@orbit-build/shared";
import type { OrbitTool, ToolContext, ToolResult } from "../types.js";

const IndexedSymbolSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["class", "interface", "function", "constant", "type"]),
  line: z.number().int().positive(),
});

const IndexedFileSchema = z.object({
  mtime: z.number().finite(),
  symbols: z.array(IndexedSymbolSchema),
  imports: z.array(z.string()).optional(),
});

/** Validates the persisted workspace symbol index before tools consume it. */
export const SymbolIndexSchema = z.object({
  files: z.record(IndexedFileSchema),
  indexedAt: z.string().min(1),
});

export type SymbolIndex = z.infer<typeof SymbolIndexSchema>;

/** Parses a persisted symbol index without allowing corrupt cache data to fail a tool call. */
export function parseSymbolIndex(raw: string): SymbolIndex | null {
  try {
    const parsed = SymbolIndexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const SearchSymbolsInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .describe("The symbol name or part of the name to search for."),
});

export type SearchSymbolsInput = z.infer<typeof SearchSymbolsInputSchema>;

export interface SymbolSearchResult {
  name: string;
  type: "class" | "interface" | "function" | "constant" | "type";
  filePath: string;
  line: number;
}

export class SearchSymbolsTool implements OrbitTool<
  SearchSymbolsInput,
  SymbolSearchResult[]
> {
  name = "search_symbols";
  description =
    "Search for symbol declarations (classes, functions, interfaces, constants) in the workspace symbol index.";
  inputSchema = SearchSymbolsInputSchema;
  risk = "read" as const;

  async execute(
    input: SearchSymbolsInput,
    ctx: ToolContext,
  ): Promise<ToolResult<SymbolSearchResult[]>> {
    try {
      const indexPath = resolveSafePath(ctx.cwd, ".orbit/symbols.json");
      if (!existsSync(indexPath)) {
        return {
          ok: true,
          data: [],
          display:
            "Symbol index is not yet built. Please try again in a few moments.",
        };
      }

      const index = parseSymbolIndex(readFileSync(indexPath, "utf8"));
      if (!index) {
        return {
          ok: true,
          data: [],
          display: "Symbol index format is invalid.",
        };
      }

      const results: SymbolSearchResult[] = [];
      const queryLower = input.query.toLowerCase();

      for (const [filePath, fileData] of Object.entries(index.files)) {
        try {
          resolveSafePath(ctx.cwd, filePath);
        } catch {
          continue;
        }
        for (const symbol of fileData.symbols) {
          if (symbol.name.toLowerCase().includes(queryLower)) {
            results.push({
              name: symbol.name,
              type: symbol.type,
              filePath,
              line: symbol.line,
            });
          }
        }
      }

      // Sort results by similarity or name
      results.sort((a, b) => a.name.localeCompare(b.name));

      const display =
        results.length > 0
          ? `Found ${results.length} matching symbol(s):\n` +
            results
              .map((r) => `- [${r.type}] ${r.name} in ${r.filePath}:${r.line}`)
              .join("\n")
          : `No symbols matching "${input.query}" found.`;

      return {
        ok: true,
        data: results,
        display,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Failed to search symbols: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
