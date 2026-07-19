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
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
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
        getCheckpoints: vi.fn(() => []),
        rewindToCheckpoint: vi.fn(async () => false),
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

  it("lists checkpoints newest-first and rewinds by displayed number", async () => {
    const cwd = temporaryWorkspace();
    const checkpoints = [
      {
        id: "checkpoint-old",
        timestamp: "2026-07-19T01:00:00Z",
        toolCallId: "tool-1",
        files: ["src/old.ts"],
      },
      {
        id: "checkpoint-new",
        timestamp: "2026-07-19T02:00:00Z",
        toolCallId: "tool-2",
        files: ["src/new.ts"],
      },
    ];
    const printOutput = vi.fn();
    const rewindToCheckpoint = vi.fn(async () => true);
    const loop = {
      rollbackLastCheckpoint: vi.fn(async () => {}),
      rollbackFileToCheckpoint: vi.fn(() => false),
      getCheckpoints: vi.fn(() => checkpoints),
      rewindToCheckpoint,
    };

    await handleRollbackCommand("/timeline", "", {
      cwd,
      language: "en",
      loop,
      printOutput,
    });
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringMatching(/1\s+checkpoint-n.*src\/new\.ts/),
    );

    await handleRollbackCommand("/rewind", "1", {
      cwd,
      language: "en",
      loop,
      printOutput,
    });
    expect(rewindToCheckpoint).toHaveBeenCalledWith("checkpoint-new");
  });

  it("rejects ambiguous checkpoint ID prefixes", async () => {
    const cwd = temporaryWorkspace();
    const printOutput = vi.fn();
    const rewindToCheckpoint = vi.fn(async () => true);
    await handleRollbackCommand("/rewind", "checkpoint-", {
      cwd,
      language: "en",
      loop: {
        rollbackLastCheckpoint: vi.fn(async () => {}),
        rollbackFileToCheckpoint: vi.fn(() => false),
        getCheckpoints: vi.fn(() => [
          {
            id: "checkpoint-one",
            timestamp: "now",
            toolCallId: "1",
            files: [],
          },
          {
            id: "checkpoint-two",
            timestamp: "now",
            toolCallId: "2",
            files: [],
          },
        ]),
        rewindToCheckpoint,
      },
      printOutput,
    });

    expect(rewindToCheckpoint).not.toHaveBeenCalled();
    expect(printOutput).toHaveBeenCalledWith(
      expect.stringContaining("matches multiple checkpoints"),
    );
  });
});
