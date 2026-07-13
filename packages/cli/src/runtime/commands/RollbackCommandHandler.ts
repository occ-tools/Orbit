import { resolveSafePath } from "@orbit-build/shared";
import { Prompt, type PromptOption } from "@orbit-build/tui";
import { execFileSync } from "child_process";
import { existsSync, rmSync } from "fs";
import picocolors from "picocolors";
import { z } from "zod";
import {
  HANDLED_COMMAND,
  type CommandHandlerResult,
  type CommandOutput,
} from "./CommandHandlerTypes.js";

const GitStatusCodeSchema = z
  .string()
  .length(2)
  .regex(/^[ MADRCU?!]{2}$/);
const GitStatusPathSchema = z.string().min(1).max(32_768);

interface RollbackLoop {
  rollbackLastCheckpoint(): Promise<void>;
  rollbackFileToCheckpoint(filePath: string): boolean;
}

interface RollbackPromptAdapter {
  askMultiSelect(
    question: string,
    options: PromptOption[],
  ): Promise<string[] | null>;
}

interface GitAdapter {
  status(cwd: string): string;
  checkout(cwd: string, filePath: string): void;
}

export interface RollbackCommandDependencies {
  cwd: string;
  language: "en" | "zh";
  loop: RollbackLoop;
  printOutput: CommandOutput;
  prompt?: RollbackPromptAdapter;
  git?: GitAdapter;
  removePath?: (absolutePath: string) => void;
}

const defaultGitAdapter: GitAdapter = {
  status: (cwd) =>
    execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  checkout: (cwd, filePath) => {
    execFileSync("git", ["checkout", "--", filePath], {
      cwd,
      stdio: "ignore",
    });
  },
};

/** Parse NUL-delimited porcelain v1 output without corrupting path whitespace. */
export function parseGitStatusPaths(output: string): string[] {
  const fields = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git returned an invalid status record.");
    }
    const status = GitStatusCodeSchema.parse(record.slice(0, 2));
    const filePath = GitStatusPathSchema.parse(record.slice(3));
    paths.push(filePath);

    if (status.includes("R") || status.includes("C")) {
      const originalPath = fields[index + 1];
      GitStatusPathSchema.parse(originalPath);
      index++;
    }
  }
  return [...new Set(paths)];
}

/** Handle `/rollback` while keeping every selected path inside the workspace. */
export async function handleRollbackCommand(
  command: string,
  argument: string,
  dependencies: RollbackCommandDependencies,
): Promise<CommandHandlerResult | null> {
  if (command !== "/rollback") return null;
  const isZh = dependencies.language === "zh";
  if (argument === "all" || argument === "--all") {
    await dependencies.loop.rollbackLastCheckpoint();
    return HANDLED_COMMAND;
  }

  const git = dependencies.git ?? defaultGitAdapter;
  let paths: string[];
  try {
    paths = parseGitStatusPaths(git.status(dependencies.cwd));
    for (const filePath of paths) {
      resolveSafePath(dependencies.cwd, filePath);
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("outside workspace")) {
      dependencies.printOutput(
        picocolors.red(
          isZh
            ? `✖ Git 状态包含工作区外路径，已拒绝回滚: ${error.message}`
            : `✖ Refused rollback path outside the workspace: ${error.message}`,
        ),
      );
      return HANDLED_COMMAND;
    }
    await dependencies.loop.rollbackLastCheckpoint();
    return HANDLED_COMMAND;
  }

  if (paths.length === 0) {
    dependencies.printOutput(
      picocolors.yellow(
        isZh
          ? "当前工作区没有检测到任何未提交的代码变更。"
          : "No uncommitted changes detected in the workspace.",
      ),
    );
    return HANDLED_COMMAND;
  }

  const options: PromptOption[] = [
    {
      value: "all",
      label: isZh
        ? "【全部回滚】 撤销所有变更"
        : "[Rollback All] Discard all changes",
    },
    ...paths.map((filePath) => ({ value: filePath, label: filePath })),
  ];
  const selected = await (dependencies.prompt ?? Prompt).askMultiSelect(
    isZh
      ? "选择要回滚（撤销变更）的文件："
      : "Select files to rollback (discard changes):",
    options,
  );
  if (!selected?.length) {
    dependencies.printOutput(
      picocolors.yellow(isZh ? "未选择任何文件。" : "No files selected."),
    );
    return HANDLED_COMMAND;
  }
  if (selected.includes("all")) {
    await dependencies.loop.rollbackLastCheckpoint();
    return HANDLED_COMMAND;
  }

  try {
    for (const filePath of selected) {
      const absolutePath = resolveSafePath(dependencies.cwd, filePath);
      if (dependencies.loop.rollbackFileToCheckpoint(filePath)) continue;
      try {
        git.checkout(dependencies.cwd, filePath);
      } catch {
        if (existsSync(absolutePath)) {
          (dependencies.removePath ?? removeWorkspacePath)(absolutePath);
        }
      }
    }
    dependencies.printOutput(
      picocolors.green(
        isZh
          ? `✔ 成功回滚以下文件的变更: ${selected.join(", ")}`
          : `✔ Successfully rolled back changes for: ${selected.join(", ")}`,
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.printOutput(
      picocolors.red(
        isZh ? `✖ 回滚操作失败: ${message}` : `✖ Rollback failed: ${message}`,
      ),
    );
  }
  return HANDLED_COMMAND;
}

function removeWorkspacePath(absolutePath: string): void {
  rmSync(absolutePath, { recursive: true, force: true });
}
