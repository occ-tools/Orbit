import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface ReferenceContext {
  filePath: string;
  line: number;
  excerpt: string;
}

export class ReferencesRetriever {
  constructor(private cwd: string) {}

  /**
   * Scans the codebase index to find occurrences of the specified symbols,
   * extracting call sites with surrounding code context.
   */
  public async getReferencesContext(
    symbols: string[],
    maxReferencesPerSymbol = 3,
    maxTotalReferences = 10,
  ): Promise<string> {
    const indexPath = join(this.cwd, ".orbit", "symbols.json");
    if (!existsSync(indexPath)) {
      return "";
    }

    let index: { files?: Record<string, any> };
    try {
      const raw = readFileSync(indexPath, "utf8");
      index = JSON.parse(raw);
    } catch {
      return "";
    }

    if (!index.files || typeof index.files !== "object") {
      return "";
    }

    const uniqueSymbols = Array.from(new Set(symbols)).filter(Boolean);
    const results: Array<{ symbol: string; references: ReferenceContext[] }> =
      [];
    let totalCollected = 0;

    for (const symbol of uniqueSymbols) {
      if (totalCollected >= maxTotalReferences) break;

      let symbolRegex: RegExp;
      try {
        const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const startBoundary = /^\w/.test(symbol) ? "\\b" : "";
        const endBoundary = /\w$/.test(symbol) ? "\\b" : "";
        symbolRegex = new RegExp(`${startBoundary}${escapedSymbol}${endBoundary}`);
      } catch {
        continue;
      }
      const symbolRefs: ReferenceContext[] = [];

      for (const [relPath, fileData] of Object.entries(index.files)) {
        if (
          symbolRefs.length >= maxReferencesPerSymbol ||
          totalCollected >= maxTotalReferences
        ) {
          break;
        }

        const absPath = join(this.cwd, relPath);
        if (!existsSync(absPath)) continue;

        try {
          const content = readFileSync(absPath, "utf8");
          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip comments and declarations of the symbol itself to only get references/calls
            if (
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*") ||
              line.includes("export ") ||
              line.includes("class ") ||
              line.includes("function ") ||
              line.includes("interface ") ||
              line.includes("type ")
            ) {
              continue;
            }

            if (symbolRegex.test(line)) {
              // Extract context: 3 lines before, 3 lines after
              const startIdx = Math.max(0, i - 3);
              const endIdx = Math.min(lines.length - 1, i + 3);
              const excerptLines = lines
                .slice(startIdx, endIdx + 1)
                .map((l, offset) => {
                  const lineNum = startIdx + offset + 1;
                  const prefix = lineNum === i + 1 ? "> " : "  ";
                  return `${prefix}${lineNum}: ${l}`;
                });

              symbolRefs.push({
                filePath: relPath,
                line: i + 1,
                excerpt: excerptLines.join("\n"),
              });

              totalCollected++;
              if (
                symbolRefs.length >= maxReferencesPerSymbol ||
                totalCollected >= maxTotalReferences
              ) {
                break;
              }
            }
          }
        } catch {
          // Ignore read errors
        }
      }

      if (symbolRefs.length > 0) {
        results.push({ symbol, references: symbolRefs });
      }
    }

    if (results.length === 0) {
      return "";
    }

    // Format output as clean Markdown
    let output = "\n### Symbol Call References (Cross-File Context)\n";
    output +=
      "The following are call sites and usage examples of symbols referenced in this task:\n\n";

    for (const item of results) {
      output += `#### References for symbol: \`${item.symbol}\`\n`;
      for (const ref of item.references) {
        output += `- **File**: [${ref.filePath}](file:///${join(this.cwd, ref.filePath).replace(/\\/g, "/")}) (Line ${ref.line})\n`;
        output += `\`\`\`typescript\n${ref.excerpt}\n\`\`\`\n\n`;
      }
    }

    return output;
  }
}
