import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { WorktreeManager } from "./WorktreeManager.js";
import { execSync } from "child_process";

describe("WorktreeManager Tests", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = path.join(tmpdir(), `orbit-wt-test-${Date.now()}`);
    fs.mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(cwd)) {
      try {
        // Clean up any remaining worktrees
        execSync("git worktree prune", { cwd, stdio: "ignore" });
      } catch {}
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("should throw error if not a git repository", () => {
    const manager = new WorktreeManager(cwd);
    expect(() => manager.createWorktree("sub-1")).toThrow("not a git repository");
  });

  it("should create worktree, commit file, merge back, and prune successfully", () => {
    // 1. Initialize git repo in cwd
    try {
      execSync("git init", { cwd, stdio: "ignore" });
      execSync("git config user.name test", { cwd, stdio: "ignore" });
      execSync("git config user.email test@example.com", { cwd, stdio: "ignore" });
      
      // Git needs at least one commit before we can create worktree off HEAD
      fs.writeFileSync(path.join(cwd, "README.md"), "hello", "utf8");
      execSync("git add README.md", { cwd, stdio: "ignore" });
      execSync('git commit -m "initial commit"', { cwd, stdio: "ignore" });
    } catch {
      // Git command failed (e.g. git not installed on windows test system)
      // Skip test gracefully
      return;
    }

    const manager = new WorktreeManager(cwd);
    
    // 2. Create worktree
    const session = manager.createWorktree("sub-1");
    expect(fs.existsSync(session.path)).toBe(true);
    expect(fs.existsSync(path.join(session.path, "README.md"))).toBe(true);

    // 3. Write new file inside worktree
    const newFilePath = path.join(session.path, "sub-file.txt");
    fs.writeFileSync(newFilePath, "subagent edit", "utf8");

    // 4. Merge and clean up
    const mergeRes = manager.mergeAndCleanup(session);
    expect(mergeRes.success).toBe(true);

    // 5. Verify the file is now in the main workspace and worktree directory is cleaned up
    expect(fs.existsSync(path.join(cwd, "sub-file.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(cwd, "sub-file.txt"), "utf8")).toBe("subagent edit");
    expect(fs.existsSync(session.path)).toBe(false);
  });
});
