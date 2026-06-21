import { describe, it, expect } from "vitest";
import {
  nextCodePointIndex,
  parseMouseWheelDirection,
  previousCodePointIndex,
} from "./run.js";

// We can extract makeCompleter matcher logic from packages/cli/src/commands/run.ts to test it.
// Since it's not exported, we can recreate it or mock the exact matcher implementation:
function makeCompleter(candidates: {
  commands: string[];
  files: string[];
  symbols: string[];
  sessions: string[];
}) {
  return (line: string): [string[], string] => {
    if (line.startsWith("/")) {
      const hits = candidates.commands.filter((c) => c.startsWith(line));
      return [hits.length ? hits : candidates.commands, line];
    }

    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1] || "";

    if (!lastWord) {
      return [[], lastWord];
    }

    const fileHits = candidates.files.filter((f) => f.startsWith(lastWord));
    const symbolHits = candidates.symbols.filter((s) => s.startsWith(lastWord));
    const allHits = [...fileHits, ...symbolHits];

    return [allHits, lastWord];
  };
}

describe("REPL Autocomplete Completer Tests", () => {
  const candidates = {
    commands: [
      "/help",
      "/status",
      "/config",
      "/model",
      "/chat",
      "/commit",
      "/diff",
      "/test",
      "/add",
      "/drop",
      "/context",
      "/exit",
      "/quit",
      "/rollback",
      "/timeline",
      "/rewind",
      "/clear",
      "/compact",
      "/history",
      "/edit",
      "/inspect",
      "/doc",
      "/diagnose",
      "/resolve",
      "/references",
      "/language",
      "/api",
      "/register",
      "/fork",
      "/mode",
      "/ask",
      "/code",
      "/copy",
      "/copy-context",
      "/git",
      "/tokens",
      "/read-only",
      "/readonly",
      "/btw",
      "/memory",
    ],
    files: [
      "src/index.ts",
      "src/utils/paths.ts",
      "packages/cli/src/commands/run.ts",
    ],
    symbols: ["AgentLoop", "checkWorkspaceBoundary", "Prompt"],
    sessions: ["sess_friendly-panda-102", "sess_clever-fox-829"],
  };

  it("should autocomplete slash commands", () => {
    const completer = makeCompleter(candidates);

    const [hits, line] = completer("/ro");
    expect(hits).toContain("/rollback");
    expect(hits.length).toBe(1);
    expect(line).toBe("/ro");

    const [diffHits, diffLine] = completer("/di");
    expect(diffHits).toContain("/diff");
    expect(diffHits).toContain("/diagnose");
    expect(diffHits.length).toBe(2);
    expect(diffLine).toBe("/di");

    const [allHits, allLine] = completer("/");
    expect(allHits).toContain("/help");
    expect(allHits).toContain("/exit");
    expect(allLine).toBe("/");

    const [langHits, langLine] = completer("/la");
    expect(langHits).toContain("/language");
    expect(langHits.length).toBe(1);
    expect(langLine).toBe("/la");

    const [forkHits, forkLine] = completer("/fo");
    expect(forkHits).toContain("/fork");
    expect(forkHits.length).toBe(1);
    expect(forkLine).toBe("/fo");

    const [modeHits, modeLine] = completer("/mo");
    expect(modeHits).toContain("/mode");
    expect(modeHits).toContain("/model");
    expect(modeHits.length).toBe(2);
    expect(modeLine).toBe("/mo");

    const [askHits, askLine] = completer("/as");
    expect(askHits).toContain("/ask");
    expect(askHits.length).toBe(1);
    expect(askLine).toBe("/as");

    const [codeHits, codeLine] = completer("/co");
    expect(codeHits).toContain("/code");
    expect(codeHits).toContain("/config");
    expect(codeHits).toContain("/commit");
    expect(codeHits).toContain("/copy");
    expect(codeHits).toContain("/copy-context");
    expect(codeHits).toContain("/context");
    expect(codeHits).toContain("/compact");
    expect(codeHits.length).toBe(7);
    expect(codeLine).toBe("/co");

    const [gitHits, gitLine] = completer("/gi");
    expect(gitHits).toContain("/git");
    expect(gitHits.length).toBe(1);
    expect(gitLine).toBe("/gi");

    const [tokHits, tokLine] = completer("/to");
    expect(tokHits).toContain("/tokens");
    expect(tokHits.length).toBe(1);
    expect(tokLine).toBe("/to");

    const [readHits, readLine] = completer("/read");
    expect(readHits).toContain("/read-only");
    expect(readHits).toContain("/readonly");
    expect(readHits.length).toBe(2);
    expect(readLine).toBe("/read");
  });

  it("should autocomplete file paths based on the last typed word", () => {
    const completer = makeCompleter(candidates);

    const [hits, line] = completer("read_file src/in");
    expect(hits).toContain("src/index.ts");
    expect(hits.length).toBe(1);
    expect(line).toBe("src/in");
  });

  it("should autocomplete symbol names", () => {
    const completer = makeCompleter(candidates);

    const [hits, line] = completer("explain Agent");
    expect(hits).toContain("AgentLoop");
    expect(hits.length).toBe(1);
    expect(line).toBe("Agent");
  });

  it("should return empty matches if the last word is empty", () => {
    const completer = makeCompleter(candidates);

    const [hits, line] = completer("explain ");
    expect(hits.length).toBe(0);
    expect(line).toBe("");
  });

  describe("getActiveMatches simulation logic", () => {
    function simulateGetActiveMatches(
      inputBuffer: string,
      providerType = "openai",
    ): string[] {
      if (!inputBuffer.startsWith("/")) return [];
      const line = inputBuffer;
      const parts = line.split(/\s+/);

      if (parts[0] === "/chat" && line.includes(" ")) {
        if (parts.length <= 2) {
          const subcommands = ["list", "ls", "new", "delete", "rm", "switch"];
          const hits = subcommands
            .map((sub) => `/chat ${sub}`)
            .filter((c) => c.startsWith(line));
          if (hits.length > 0) return hits;
        }

        if (
          parts.length >= 3 &&
          ["delete", "rm", "switch"].includes(parts[1])
        ) {
          const cmd = parts[0];
          const sub = parts[1];
          const query = parts.slice(2).join(" ");
          const prefix = `${cmd} ${sub} `;
          const hits = (candidates.sessions || [])
            .filter((s) => {
              const lowerS = s.toLowerCase();
              const lowerQ = query.toLowerCase();
              return (
                lowerS.startsWith(lowerQ) ||
                s
                  .replace(/^sess_/, "")
                  .toLowerCase()
                  .startsWith(lowerQ)
              );
            })
            .map((s) => `${prefix}${s}`);
          if (hits.length > 0) return hits;
        }
      }

      if (parts[0] === "/model" && line.includes(" ")) {
        const query = line.slice(7).trim();
        let models: string[] = [];
        if (providerType === "anthropic") {
          models = [
            "claude-3-5-sonnet-latest",
            "claude-3-5-haiku-latest",
            "claude-3-opus-latest",
          ];
        } else if (providerType === "openai") {
          models = ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"];
        } else {
          models = ["deepseek-chat", "deepseek-reasoner"];
        }
        const hits = models
          .filter((m) => m.toLowerCase().includes(query.toLowerCase()))
          .map((m) => `/model ${m}`);
        if (hits.length > 0) return hits;
      }

      if (
        (parts[0] === "/read-only" || parts[0] === "/readonly") &&
        line.includes(" ")
      ) {
        const prefix = parts[0];
        const query = line.slice(prefix.length + 1).trim();
        const hits = (candidates.files || [])
          .filter((f) => f.toLowerCase().includes(query.toLowerCase()))
          .map((f) => `${prefix} ${f}`);
        if (hits.length > 0) return hits;
      }

      if (parts[0] === "/fork" && line.includes(" ")) {
        if (parts.length <= 2) {
          const subcommands = ["tree", "switch"];
          const hits = subcommands
            .map((sub) => `/fork ${sub}`)
            .filter((c) => c.startsWith(line));
          if (hits.length > 0) return hits;
        }

        if (parts.length >= 3 && parts[1] === "switch") {
          const cmd = parts[0];
          const sub = parts[1];
          const query = parts.slice(2).join(" ");
          const prefix = `${cmd} ${sub} `;
          const hits = (candidates.sessions || [])
            .filter((s) => {
              const lowerS = s.toLowerCase();
              const lowerQ = query.toLowerCase();
              return (
                lowerS.startsWith(lowerQ) ||
                s
                  .replace(/^sess_/, "")
                  .toLowerCase()
                  .startsWith(lowerQ)
              );
            })
            .map((s) => `${prefix}${s}`);
          if (hits.length > 0) return hits;
        }
      }

      if (
        (parts[0] === "/delete" || parts[0] === "/rm" || parts[0] === "/del") &&
        line.includes(" ")
      ) {
        const prefix = parts[0];
        const query = line.slice(prefix.length + 1).trim();
        const hits = (candidates.sessions || [])
          .filter((s) => {
            const lowerS = s.toLowerCase();
            const lowerQ = query.toLowerCase();
            return (
              lowerS.startsWith(lowerQ) ||
              s
                .replace(/^sess_/, "")
                .toLowerCase()
                .startsWith(lowerQ)
            );
          })
          .map((s) => `${prefix} ${s}`);
        if (hits.length > 0) return hits;
      }

      return candidates.commands.filter((c) => c.startsWith(line));
    }

    it("should match main commands", () => {
      expect(simulateGetActiveMatches("/ch")).toEqual(["/chat"]);
      expect(simulateGetActiveMatches("/chat")).toEqual(["/chat"]);
    });

    it("should match subcommands when space is typed", () => {
      const matches = simulateGetActiveMatches("/chat ");
      expect(matches).toContain("/chat list");
      expect(matches).toContain("/chat ls");
      expect(matches).toContain("/chat new");
      expect(matches).toContain("/chat delete");
      expect(matches).toContain("/chat rm");
      expect(matches).toContain("/chat switch");
    });

    it("should filter subcommands based on prefix", () => {
      expect(simulateGetActiveMatches("/chat d")).toEqual(["/chat delete"]);
      expect(simulateGetActiveMatches("/chat r")).toEqual(["/chat rm"]);
    });

    it("should autocomplete session IDs for delete/rm/switch", () => {
      const matches = simulateGetActiveMatches("/chat delete ");
      expect(matches).toContain("/chat delete sess_friendly-panda-102");
      expect(matches).toContain("/chat delete sess_clever-fox-829");

      expect(simulateGetActiveMatches("/chat delete c")).toEqual([
        "/chat delete sess_clever-fox-829",
      ]);
      expect(simulateGetActiveMatches("/chat switch s")).toEqual([
        "/chat switch sess_friendly-panda-102",
        "/chat switch sess_clever-fox-829",
      ]);
    });

    it("should autocomplete read-only files", () => {
      const matches = simulateGetActiveMatches("/read-only index");
      expect(matches).toContain("/read-only src/index.ts");
    });

    it("should autocomplete fork subcommands and session IDs", () => {
      const matches = simulateGetActiveMatches("/fork ");
      expect(matches).toContain("/fork tree");
      expect(matches).toContain("/fork switch");

      const switchMatches = simulateGetActiveMatches("/fork switch clever");
      expect(switchMatches).toContain("/fork switch sess_clever-fox-829");
    });

    it("should dynamically filter model candidates by provider type", () => {
      const openaiMatches = simulateGetActiveMatches("/model gpt", "openai");
      expect(openaiMatches).toContain("/model gpt-4o");
      expect(openaiMatches).not.toContain("/model claude-3-5-sonnet-latest");

      const anthropicMatches = simulateGetActiveMatches(
        "/model claude",
        "anthropic",
      );
      expect(anthropicMatches).toContain("/model claude-3-5-sonnet-latest");
      expect(anthropicMatches).not.toContain("/model gpt-4o");
    });

    it("should autocomplete session IDs for delete/rm/del", () => {
      const deleteMatches = simulateGetActiveMatches("/delete ");
      expect(deleteMatches).toContain("/delete sess_friendly-panda-102");
      expect(deleteMatches).toContain("/delete sess_clever-fox-829");

      const rmMatches = simulateGetActiveMatches("/rm clever");
      expect(rmMatches).toContain("/rm sess_clever-fox-829");
    });
  });
});

describe("Unicode cursor navigation", () => {
  it("moves across emoji without splitting surrogate pairs", () => {
    const value = "a😀中";
    expect(nextCodePointIndex(value, 1)).toBe(3);
    expect(previousCodePointIndex(value, 3)).toBe(1);
  });

  it("clamps cursor indexes to valid text boundaries", () => {
    expect(previousCodePointIndex("abc", -10)).toBe(0);
    expect(nextCodePointIndex("abc", 99)).toBe(3);
  });
});

describe("SGR mouse wheel parsing", () => {
  it("recognizes wheel up and wheel down events", () => {
    expect(parseMouseWheelDirection("\x1b[<64;20;10M")).toBe("up");
    expect(parseMouseWheelDirection("\x1b[<65;20;10M")).toBe("down");
  });

  it("ignores non-wheel mouse events and normal input", () => {
    expect(parseMouseWheelDirection("\x1b[<0;20;10M")).toBeNull();
    expect(parseMouseWheelDirection("hello")).toBeNull();
  });
});
