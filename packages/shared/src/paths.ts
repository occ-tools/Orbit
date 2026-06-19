import { resolve, normalize, isAbsolute } from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";

export function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, "/");
}

export function checkWorkspaceBoundary(
  workspaceRoot: string,
  targetPath: string,
): boolean {
  const normalizedRoot = normalizePath(resolve(workspaceRoot));
  const normalizedTarget = normalizePath(resolve(targetPath));

  if (normalizedTarget === normalizedRoot) {
    return true;
  }
  return normalizedTarget.startsWith(normalizedRoot + "/");
}

export function resolveSafePath(
  workspaceRoot: string,
  relativeOrAbsolutePath: string,
): string {
  const resolvedPath = isAbsolute(relativeOrAbsolutePath)
    ? resolve(relativeOrAbsolutePath)
    : resolve(workspaceRoot, relativeOrAbsolutePath);

  const safe = checkWorkspaceBoundary(workspaceRoot, resolvedPath);
  if (!safe) {
    throw new Error(
      `Path validation failed: "${relativeOrAbsolutePath}" is outside workspace boundary "${workspaceRoot}"`,
    );
  }

  return normalizePath(resolvedPath);
}

export function getGitBranch(cwd: string): string {
  const gitDir = resolve(cwd, ".git");
  if (!existsSync(gitDir)) {
    return "";
  }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    })
      .toString()
      .trim();
    return branch.replace(/[^a-zA-Z0-9_\-]/g, "_") || "main";
  } catch {
    return "";
  }
}
