import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAutocompleteCandidates } from "./AutocompleteCandidates.js";

describe("getAutocompleteCandidates", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-autocomplete-"));
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, ".orbit", "commands"), { recursive: true });
    mkdirSync(join(cwd, ".orbit", "sessions", "session-1"), {
      recursive: true,
    });
    writeFileSync(join(cwd, "src", "index.ts"), "export {};\n");
    writeFileSync(join(cwd, "src", "ignored.tmp"), "ignored\n");
    writeFileSync(join(cwd, ".orbit", "commands", "review.md"), "Review $1");
    writeFileSync(
      join(cwd, ".orbit", "symbols.json"),
      JSON.stringify({
        files: {
          "src/index.ts": {
            symbols: [{ name: "main" }, { name: "main" }],
          },
        },
      }),
    );
    writeFileSync(
      join(cwd, ".orbit", "sessions", "session-1", "session.json"),
      "{}",
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("collects validated and de-duplicated workspace candidates", async () => {
    const candidates = await getAutocompleteCandidates(cwd, {
      context: { ignore: ["**/*.tmp"] },
    });

    expect(candidates.commands).toContain("/help");
    expect(candidates.commands).toContain("/review");
    expect(candidates.files).toContain("src/index.ts");
    expect(candidates.files).not.toContain("src/ignored.tmp");
    expect(candidates.symbols).toEqual(["main"]);
    expect(candidates.sessions).toEqual(["session-1"]);
  });

  it("ignores malformed symbol indexes without losing other candidates", async () => {
    writeFileSync(join(cwd, ".orbit", "symbols.json"), "not-json");
    const candidates = await getAutocompleteCandidates(cwd, {});
    expect(candidates.commands).toContain("/help");
    expect(candidates.symbols).toEqual([]);
  });
});
