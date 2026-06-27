import { z } from "zod";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";

export const WebSearchInputSchema = z.object({
  query: z.string(),
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface SearchStrategy {
  name: string;
  url: string;
  userAgent: string;
  parser: (html: string) => SearchResult[];
}

export class WebSearchTool implements OrbitTool<WebSearchInput, string> {
  name = "web_search";
  description =
    "Search the web using DuckDuckGo to find documentation, API usage, or code examples.";
  inputSchema = WebSearchInputSchema;
  risk = "network" as const;

  private cleanText(str: string): string {
    return str
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private parseHtmlResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const resultBlockRegex = /<div class="[^"]*result__body[^"]*">([\s\S]*?)<div class="clear"><\/div>/g;

    let match;
    while ((match = resultBlockRegex.exec(html)) !== null) {
      const block = match[1];

      const anchorRegex = /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      const anchorMatch = anchorRegex.exec(block);
      if (!anchorMatch) continue;

      const anchorTag = anchorMatch[0];
      const titleText = anchorMatch[1];

      const hrefMatch = /href="([^"]+)"/i.exec(anchorTag);
      if (!hrefMatch) continue;

      let link = hrefMatch[1];
      if (link.startsWith("//")) {
        link = "https:" + link;
      }
      if (link.includes("uddg=")) {
        const parts = link.split("uddg=");
        if (parts[1]) {
          link = decodeURIComponent(parts[1].split("&")[0]);
        }
      }

      const title = this.cleanText(titleText);

      const snippetRegex = /<(?:a|span|div)\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/gi;
      const snippetMatch = snippetRegex.exec(block);
      const snippet = snippetMatch ? this.cleanText(snippetMatch[1]) : "";

      if (
        link.includes("y.js") ||
        link.includes("/y.js") ||
        link.includes("ad_provider=")
      ) {
        continue;
      }

      results.push({ title, link, snippet });
    }

    if (results.length === 0) {
      const fallbackRegex = /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = fallbackRegex.exec(html)) !== null) {
        const anchorTag = match[0];
        const titleText = match[1];
        const hrefMatch = /href="([^"]+)"/i.exec(anchorTag);
        if (!hrefMatch) continue;

        let link = hrefMatch[1];
        if (link.startsWith("//")) {
          link = "https:" + link;
        }
        if (link.includes("uddg=")) {
          const parts = link.split("uddg=");
          if (parts[1]) {
            link = decodeURIComponent(parts[1].split("&")[0]);
          }
        }
        const title = this.cleanText(titleText);

        if (
          link.includes("y.js") ||
          link.includes("/y.js") ||
          link.includes("ad_provider=")
        ) {
          continue;
        }

        results.push({ title, link, snippet: "" });
      }
    }

    return results;
  }

  private parseLiteResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const regex = /(\d+)\.&nbsp;\s*<\/td>\s*<td>\s*(<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>)/gi;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const anchorTag = match[2];
      const titleText = match[3];

      const hrefMatch =
        /href="([^"]+)"/i.exec(anchorTag) || /href='([^']+)'/i.exec(anchorTag);
      if (!hrefMatch) continue;

      let link = hrefMatch[1];
      if (link.startsWith("//")) {
        link = "https:" + link;
      }
      if (link.includes("uddg=")) {
        const parts = link.split("uddg=");
        if (parts[1]) {
          link = decodeURIComponent(parts[1].split("&")[0]);
        }
      }

      const title = this.cleanText(titleText);

      const subHtml = html.substring(match.index, match.index + 2000);
      const snippetMatch =
        /<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(
          subHtml,
        );
      const snippet = snippetMatch ? this.cleanText(snippetMatch[1]) : "";

      if (
        link.includes("y.js") ||
        link.includes("/y.js") ||
        link.includes("ad_provider=")
      ) {
        continue;
      }

      results.push({ title, link, snippet });
    }

    return results;
  }

  async execute(
    input: WebSearchInput,
    _ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    const query = input.query;
    const strategies: SearchStrategy[] = [
      {
        name: "HTML (Firefox UA)",
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
        parser: (html) => this.parseHtmlResults(html),
      },
      {
        name: "Lite (Chrome UA)",
        url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        parser: (html) => this.parseLiteResults(html),
      },
      {
        name: "HTML (Safari UA)",
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        parser: (html) => this.parseHtmlResults(html),
      },
    ];

    const errors: string[] = [];

    for (const strategy of strategies) {
      try {
        const response = await fetch(strategy.url, {
          headers: {
            "User-Agent": strategy.userAgent,
          },
        });

        if (response.status !== 200) {
          errors.push(
            `${strategy.name} status ${response.status}: ${response.statusText}`,
          );
          continue;
        }

        const html = await response.text();
        const results = strategy.parser(html);

        if (results.length > 0) {
          const formatted = results
            .map(
              (r, i) =>
                `[${i + 1}] Title: ${r.title}\n    Link: ${r.link}\n    Summary: ${r.snippet}`,
            )
            .join("\n\n");

          return {
            ok: true,
            data: formatted,
            display: `Web search returned ${results.length} results via ${strategy.name}.`,
          };
        } else {
          errors.push(`${strategy.name} returned 0 results`);
        }
      } catch (e: any) {
        errors.push(`${strategy.name} error: ${e.message}`);
      }
    }

    return {
      ok: false,
      error: `All search strategies failed. Logged errors:\n- ${errors.join("\n- ")}`,
    };
  }
}
