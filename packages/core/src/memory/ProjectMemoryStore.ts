import { randomUUID } from "crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";
import { redactSecrets, resolveSafePath } from "@orbit-build/shared";
import { z } from "zod";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export const ProjectMemoryEntrySchema = z.object({
  id: z.string().regex(/^mem_[a-f0-9-]+$/),
  text: z.string().trim().min(1).max(2000),
  source: z.literal("user"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProjectMemorySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  enabled: z.boolean().default(true),
  entries: z.array(ProjectMemoryEntrySchema).max(100),
  updatedAt: z.string().datetime(),
});

export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;
export type ProjectMemoryEntry = z.infer<typeof ProjectMemoryEntrySchema>;

/** Explicit, project-scoped memory. It never learns from conversation automatically. */
export class ProjectMemoryStore {
  private readonly memoryPath: string;

  constructor(cwd: string, relativePath = ".orbit/memory.json") {
    this.memoryPath = resolveSafePath(cwd, relativePath);
  }

  public read(): ProjectMemory {
    for (const candidate of [this.memoryPath, `${this.memoryPath}.bak`]) {
      if (!existsSync(candidate)) continue;
      this.assertSafeFile(candidate);
      try {
        const parsed = ProjectMemorySchema.safeParse(
          JSON.parse(readFileSync(candidate, "utf8")),
        );
        if (parsed.success) return parsed.data;
      } catch {
        // Fall back to the last known-good project-memory copy.
      }
    }
    return emptyMemory();
  }

  public add(text: string): ProjectMemoryEntry {
    const sanitized = sanitizeMemoryText(text);
    const now = new Date().toISOString();
    const entry = ProjectMemoryEntrySchema.parse({
      id: `mem_${randomUUID()}`,
      text: sanitized,
      source: "user",
      createdAt: now,
      updatedAt: now,
    });
    const memory = this.read();
    this.write({
      ...memory,
      entries: [...memory.entries, entry],
      updatedAt: now,
    });
    return entry;
  }

  public remove(id: string): boolean {
    const memory = this.read();
    const entries = memory.entries.filter((entry) => entry.id !== id);
    if (entries.length === memory.entries.length) return false;
    this.write({ ...memory, entries, updatedAt: new Date().toISOString() });
    return true;
  }

  public clear(): void {
    const current = this.read();
    this.write({
      ...current,
      entries: [],
      updatedAt: new Date().toISOString(),
    });
  }

  public setEnabled(enabled: boolean): ProjectMemory {
    const memory = {
      ...this.read(),
      enabled,
      updatedAt: new Date().toISOString(),
    };
    this.write(memory);
    return ProjectMemorySchema.parse(memory);
  }

  private write(value: ProjectMemory): void {
    const validated = ProjectMemorySchema.parse(value);
    const directory = dirname(this.memoryPath);
    if (existsSync(directory)) {
      const stats = lstatSync(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("Orbit memory directory must be a real directory.");
      }
    } else {
      mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    }
    this.assertSafeFile(this.memoryPath);
    const temporaryPath = `${this.memoryPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(validated, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: PRIVATE_FILE_MODE,
      });
      if (existsSync(this.memoryPath)) {
        const backupPath = `${this.memoryPath}.bak`;
        this.assertSafeFile(backupPath);
        copyFileSync(this.memoryPath, backupPath);
      }
      replaceFile(temporaryPath, this.memoryPath);
      if (process.platform !== "win32")
        chmodSync(this.memoryPath, PRIVATE_FILE_MODE);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  private assertSafeFile(filePath: string): void {
    if (!existsSync(filePath)) return;
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Orbit project memory must be a real file.");
    }
  }
}

function replaceFile(temporaryPath: string, destinationPath: string): void {
  try {
    renameSync(temporaryPath, destinationPath);
    return;
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";
    if (!["EPERM", "EEXIST", "ENOTEMPTY"].includes(code)) throw error;
  }
  rmSync(destinationPath, { force: true });
  renameSync(temporaryPath, destinationPath);
}

function sanitizeMemoryText(value: string): string {
  return redactSecrets(value)
    .replace(
      /\b(api[-_ ]?key|authorization|access[-_ ]?token|secret)(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2***REDACTED***",
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer ***REDACTED***")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "***REDACTED***")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyMemory(): ProjectMemory {
  return {
    schemaVersion: 1,
    enabled: true,
    entries: [],
    updatedAt: new Date(0).toISOString(),
  };
}
