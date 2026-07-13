import { dirname, isAbsolute, normalize, relative, resolve } from "path";
import { execSync } from "child_process";
import { existsSync, lstatSync, realpathSync } from "fs";

export function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, "/");
}

export function checkWorkspaceBoundary(
  workspaceRoot: string,
  targetPath: string,
): boolean {
  return isSameOrDescendant(resolve(workspaceRoot), resolve(targetPath));
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

  const resolvedRoot = resolve(workspaceRoot);
  const canonicalRoot = canonicalizeExistingPath(resolvedRoot);
  const existingAncestor = findNearestExistingAncestor(resolvedPath);
  const canonicalAncestor = canonicalizeExistingPath(existingAncestor);
  if (!isSameOrDescendant(canonicalRoot, canonicalAncestor)) {
    throw new Error(
      `Path validation failed: "${relativeOrAbsolutePath}" resolves through a symbolic link or junction outside workspace boundary "${workspaceRoot}"`,
    );
  }

  if (pathExistsIncludingSymlink(resolvedPath)) {
    const canonicalTarget = canonicalizeExistingPath(resolvedPath);
    if (!isSameOrDescendant(canonicalRoot, canonicalTarget)) {
      throw new Error(
        `Path validation failed: "${relativeOrAbsolutePath}" resolves outside workspace boundary "${workspaceRoot}"`,
      );
    }
  }

  return normalizePath(resolvedPath);
}

function canonicalizeExistingPath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to resolve safe path "${filePath}": ${message}`);
  }
}

function findNearestExistingAncestor(filePath: string): string {
  let current = filePath;
  while (!pathExistsIncludingSymlink(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find an existing ancestor for "${filePath}".`);
    }
    current = parent;
  }
  return current;
}

function pathExistsIncludingSymlink(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSameOrDescendant(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizeForComparison(rootPath);
  const normalizedTarget = normalizeForComparison(targetPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function normalizeForComparison(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
