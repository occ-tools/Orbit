import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { generateId, resolveSafePath } from "@orbit-build/shared";

const SUBAGENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const WORKTREE_BRANCH_PATTERN = /^orbit-wt-[a-zA-Z0-9_-]+$/;

export interface WorktreeSession {
  path: string;
  branchName: string;
}

export interface WorktreeMergeResult {
  success: boolean;
  conflictFiles?: string[];
  error?: string;
  preserved?: boolean;
}

export class WorktreeManager {
  private readonly worktreeRoot: string;

  constructor(private cwd: string) {
    this.worktreeRoot = path.join(cwd, ".orbit", "worktrees");
  }

  public isGitRepo(): boolean {
    try {
      return this.git(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
    } catch {
      return false;
    }
  }

  public createWorktree(subagentId: string): WorktreeSession {
    if (!this.isGitRepo()) {
      throw new Error(
        "Cannot create git worktree: directory is not a git repository.",
      );
    }
    if (!SUBAGENT_ID_PATTERN.test(subagentId)) {
      throw new Error(`Invalid subagent id: ${subagentId}`);
    }

    const branchName = `orbit-wt-${subagentId}-${generateId("lbl").slice(0, 8)}`;
    fs.mkdirSync(this.worktreeRoot, { recursive: true });
    const worktreePath = resolveSafePath(this.worktreeRoot, subagentId);

    if (fs.existsSync(worktreePath)) {
      try {
        this.git(["worktree", "remove", "--force", worktreePath]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Existing worktree could not be removed safely: ${message}`,
        );
      }
    }

    this.git(["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
    return { path: worktreePath, branchName };
  }

  public mergeAndCleanup(session: WorktreeSession): WorktreeMergeResult {
    try {
      this.assertManagedSession(session);
    } catch (error: unknown) {
      return { success: false, error: toErrorMessage(error), preserved: true };
    }
    if (!this.isGitRepo()) {
      return {
        success: false,
        error: "Main workspace is not a git repository.",
        preserved: true,
      };
    }

    try {
      this.git(["add", "-A"], session.path);
      if (this.git(["status", "--porcelain"], session.path).trim()) {
        this.git(
          [
            "commit",
            "--no-verify",
            "--no-gpg-sign",
            "-m",
            "subagent automatic worktree commit",
          ],
          session.path,
        );
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to commit worktree changes: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    try {
      this.git(["merge", "--no-edit", session.branchName]);
    } catch (error: unknown) {
      const conflictFiles = this.getConflictFiles();
      try {
        this.git(["merge", "--abort"]);
      } catch {
        // Preserve Git's conflict state if abort is not possible.
      }
      return {
        success: false,
        conflictFiles,
        error: `Failed to merge worktree branch: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    try {
      this.git(["worktree", "remove", session.path]);
      this.git(["branch", "-d", session.branchName]);
    } catch (error: unknown) {
      return {
        success: true,
        error: `Changes were merged, but cleanup is incomplete: ${toErrorMessage(error)}`,
        preserved: true,
      };
    }

    return { success: true };
  }

  public discardWorktree(session: WorktreeSession): void {
    this.assertManagedSession(session);
    if (fs.existsSync(session.path)) {
      this.git(["worktree", "remove", "--force", session.path]);
    }
    try {
      this.git(["branch", "-D", session.branchName]);
    } catch {
      // The branch may not have been created or may already be gone.
    }
  }

  private assertManagedSession(session: WorktreeSession): void {
    if (!WORKTREE_BRANCH_PATTERN.test(session.branchName)) {
      throw new Error(`Invalid managed worktree branch: ${session.branchName}`);
    }
    const expectedRoot = path.resolve(this.worktreeRoot);
    const sessionPath = path.resolve(session.path);
    const relativePath = path.relative(expectedRoot, sessionPath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      relativePath.includes(path.sep)
    ) {
      throw new Error(
        `Worktree path is outside the managed root: ${session.path}`,
      );
    }
  }

  private getConflictFiles(): string[] {
    try {
      return this.git(["diff", "--name-only", "--diff-filter=U"])
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private git(args: string[], cwd = this.cwd): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
