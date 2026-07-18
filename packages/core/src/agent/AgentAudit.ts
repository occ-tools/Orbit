import { createHash } from "crypto";

const AUDIT_CONTENT_MAX_CHARS = 40_000;

export function isFileMutationTool(toolName: string): boolean {
  return [
    "write_file",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
  ].includes(toolName);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildAuditDiff(
  filePath: string,
  before: string | null,
  after: string,
): string {
  const bounded = (value: string): string =>
    value.length <= AUDIT_CONTENT_MAX_CHARS
      ? value
      : `${value.slice(0, AUDIT_CONTENT_MAX_CHARS)}\n... [truncated by Orbit audit]`;
  const beforeText = bounded(before ?? "")
    .split("\n")
    .map((line) => `-${line}`)
    .join("\n");
  const afterText = bounded(after)
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
  return `--- a/${filePath}\n+++ b/${filePath}\n@@ Orbit recorded before/after @@\n${beforeText}\n${afterText}`;
}
