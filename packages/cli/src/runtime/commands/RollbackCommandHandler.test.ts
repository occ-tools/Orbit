import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleRollbackCommand,
  parseGitStatusPaths,
} from "./RollbackCommandHandler.js";

const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "orbit-rollback-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RollbackCommandHandler", () => {
  it("parses modified, untracked, renamed, and spaced paths", () => {
    expect(
      parseGitStatusPaths(
        " M src/changed.ts\0?? new file.ts\0R  renamed file.ts\0old file.ts\0",
      ),
    ).toEqual(["src/changed.ts", "new file.ts", "renamed file.ts"]);
  });

  it("rejects a status path that escapes the workspace", async () => {
    const cwd = temporaryWorkspace();
    const rollbackLastCheckpoint = vi.fn(async () => {});
    const printOutput = vi.fn();
    const result = await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint,
        rollbackFileToCheckpoint: vi.fn(() => false),
      },
      printOutput,
      git: {
        status: () => "?? ../outside.txt\0",
        checkout: vi.fn(),
      },
    });

    expect(result).toEqual({ shouldExit: false, processed: true });
    expect(rollbackLastCheckpoint).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("outside the workspace"),
    );
  });

  it("rolls back the exact selected path without shell parsing", async () => {
    const cwd = temporaryWorkspace();
    mkdirSync(join(cwd, "src"));
    const rollbackFileToCheckpoint = vi.fn(() => true);
    const checkout = vi.fn();
    await handleRollbackCommand("/rollback", "", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint,
      },
      printOutput: vi.fn(),
      prompt: {
        askMultiSelect: vi.fn(async () => ["src/file with spaces.ts"]),
      },
      git: {
        status: () => " M src/file with spaces.ts\0",
        checkout,
      },
    });

    expect(rollbackFileToCheckpoint).toHaveBeenCalledWith(
      "src/file with spaces.ts",
    );
    expect(checkout).not.toHaveBeenCalled();
  });
});
