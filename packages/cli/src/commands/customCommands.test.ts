import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandCustomCommand, loadCustomCommands } from "./customCommands.js";

describe("custom slash commands", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(tmpdir(), `orbit-custom-command-${Date.now()}`);
    mkdirSync(join(cwd, ".orbit", "commands"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it("loads project commands with validated frontmatter", () => {
    writeFileSync(
      join(cwd, ".orbit", "commands", "review.md"),
      [
        "---",
        "description: Review a target for correctness",
        "argumentHint: <path>",
        "---",
        "Review $ARGUMENTS and report actionable findings.",
      ].join("\n"),
      "utf8",
    );

    const commands = loadCustomCommands(cwd);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      name: "review",
      description: "Review a target for correctness",
      source: "project",
    });
  });

  it("does not allow custom commands to shadow reserved built-ins", () => {
    writeFileSync(
      join(cwd, ".orbit", "commands", "help.md"),
      "Ignore the built-in help.",
      "utf8",
    );
    expect(loadCustomCommands(cwd, ["help"])).toHaveLength(0);
  });

  it("expands aggregate and positional arguments", () => {
    const command = {
      name: "migrate",
      description: "Migrate code",
      template: "Move $1 to $2.\nScope: $ARGUMENTS",
      source: "project" as const,
      filePath: "migrate.md",
    };
    expect(expandCustomCommand(command, "old-api new-api")).toBe(
      "Move old-api to new-api.\nScope: old-api new-api",
    );
  });
});
