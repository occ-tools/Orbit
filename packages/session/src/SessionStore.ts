import { randomUUID } from "crypto";
import { isAbsolute, join, relative, resolve, sep } from "path";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { generateId, resolveSafePath } from "@orbit-build/shared";
import {
  FileChangeRecordSchema,
  StoredHistorySchema,
  SessionEventSchema,
  SessionIdSchema,
  SessionSchema,
  ToolCallRecordSchema,
} from "./types.js";
import type {
  FileChangeRecord,
  Session,
  SessionEvent,
  StoredHistoryMessage,
  ToolCallRecord,
} from "./types.js";
import {
  redactAuditJson,
  redactAuditText,
  sanitizeAuditValue,
} from "./auditSerialization.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SessionCreationInputSchema = SessionSchema.pick({
  provider: true,
  model: true,
});

function writeJsonAtomically(filePath: string, value: unknown): void {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error(`Unable to serialize JSON for ${filePath}.`);
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
    replaceFileAtomically(temporaryPath, filePath);
  } finally {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // A cleanup failure must not hide the original write/rename failure.
    }
  }
}

function replaceFileAtomically(
  temporaryPath: string,
  destinationPath: string,
): void {
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

  // Windows can reject rename-over-existing even after both handles are
  // closed. Rotate the previous file to a unique backup, install the complete
  // temp file, then remove the backup. Restore it if installation fails.
  const backupPath = `${destinationPath}.${process.pid}.${randomUUID()}.bak`;
  let previousMoved = false;
  try {
    if (existsSync(destinationPath)) {
      renameSync(destinationPath, backupPath);
      previousMoved = true;
    }
    renameSync(temporaryPath, destinationPath);
    if (previousMoved) {
      try {
        rmSync(backupPath, { force: true });
      } catch {
        // A stale backup is safer than failing an otherwise valid write.
      }
    }
  } catch (error: unknown) {
    if (
      previousMoved &&
      existsSync(backupPath) &&
      !existsSync(destinationPath)
    ) {
      try {
        renameSync(backupPath, destinationPath);
      } catch {
        // Preserve the replacement failure; the uniquely named backup remains
        // available for recovery.
      }
    }
    throw error;
  } finally {
    if (existsSync(destinationPath)) {
      try {
        rmSync(backupPath, { force: true });
      } catch {
        // Cleanup must not mask a successful replacement.
      }
    }
  }
}

function appendJsonLine(filePath: string, value: unknown): void {
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: PRIVATE_FILE_MODE,
  });
}

export class SessionStore {
  private readonly cwd: string;
  private readonly sessionRootPath: string;

  constructor(cwd: string, sessionRootPath = ".orbit/sessions") {
    this.cwd = resolve(cwd);
    this.sessionRootPath = sessionRootPath.trim();
  }

  public createSession(provider: string, model: string): Session {
    const creationInput = SessionCreationInputSchema.parse({ provider, model });
    const sessionRoot = this.resolveSessionRoot();
    mkdirSync(sessionRoot, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
    const { id, directory } = this.createUniqueSessionDirectory();
    const now = new Date().toISOString();
    const session = SessionSchema.parse({
      id,
      cwd: this.cwd,
      title: "New Orbit Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
      provider: creationInput.provider,
      model: creationInput.model,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostEstimate: 0,
    });

    try {
      writeJsonAtomically(join(directory, "session.json"), session);
    } catch (error: unknown) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }

    return session;
  }

  public getSession(id: string): Session | undefined {
    let sessionFile: string;
    try {
      sessionFile = join(this.resolveSessionDirectory(id), "session.json");
    } catch {
      return undefined;
    }
    if (!existsSync(sessionFile)) return undefined;
    try {
      const parsed = SessionSchema.safeParse(
        JSON.parse(readFileSync(sessionFile, "utf8")),
      );
      if (!parsed.success || parsed.data.id !== id) return undefined;
      return parsed.data;
    } catch {
      return undefined;
    }
  }

  public updateSession(session: Session): void {
    const validated = SessionSchema.parse(session);
    const sessionFile = join(
      this.resolveSessionDirectory(validated.id),
      "session.json",
    );
    const updated = SessionSchema.parse({
      ...validated,
      updatedAt: new Date().toISOString(),
    });
    writeJsonAtomically(sessionFile, updated);
  }

  public listSessions(): Session[] {
    let sessionRoot: string;
    let dirs: string[];
    try {
      sessionRoot = this.resolveSessionRoot();
      if (!existsSync(sessionRoot)) return [];
      dirs = readdirSync(sessionRoot);
    } catch {
      return [];
    }
    const sessions: Session[] = [];
    for (const dir of dirs) {
      const sess = this.getSession(dir);
      if (sess) sessions.push(sess);
    }
    return sessions.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }

  public appendEvent(
    sessionId: string,
    type: string,
    payload: unknown,
  ): SessionEvent {
    const event = SessionEventSchema.parse({
      id: generateId("evt"),
      sessionId,
      type,
      payload: sanitizeAuditValue(payload),
      createdAt: new Date().toISOString(),
    });

    const file = join(this.resolveSessionDirectory(sessionId), "events.jsonl");
    appendJsonLine(file, event);
    return event;
  }

  public getEvents(sessionId: string): SessionEvent[] {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), "events.jsonl");
    } catch {
      return [];
    }
    if (!existsSync(file)) return [];
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      return [];
    }
    return content
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const parsed = SessionEventSchema.safeParse(JSON.parse(line));
          return parsed.success && parsed.data.sessionId === sessionId
            ? [
                {
                  id: parsed.data.id,
                  sessionId: parsed.data.sessionId,
                  type: parsed.data.type,
                  payload: parsed.data.payload,
                  createdAt: parsed.data.createdAt,
                },
              ]
            : [];
        } catch {
          return [];
        }
      });
  }

  public recordToolCall(
    record: Omit<ToolCallRecord, "startedAt">,
  ): ToolCallRecord {
    const fullRecord = ToolCallRecordSchema.parse({
      ...record,
      inputJson: redactAuditJson(record.inputJson),
      outputJson:
        record.outputJson === undefined
          ? undefined
          : redactAuditJson(record.outputJson),
      startedAt: new Date().toISOString(),
    });

    const file = join(
      this.resolveSessionDirectory(record.sessionId),
      "tool_calls.jsonl",
    );
    appendJsonLine(file, fullRecord);
    return fullRecord;
  }

  public recordFileChange(
    record: Omit<FileChangeRecord, "createdAt" | "id">,
  ): FileChangeRecord {
    const fullRecord = FileChangeRecordSchema.parse({
      ...record,
      diff: redactAuditText(record.diff),
      id: generateId("fc"),
      createdAt: new Date().toISOString(),
    });

    const file = join(
      this.resolveSessionDirectory(record.sessionId),
      "file_changes.jsonl",
    );
    appendJsonLine(file, fullRecord);
    return fullRecord;
  }

  public saveHistory(sessionId: string, history: unknown): void {
    const validated = StoredHistorySchema.parse(history);
    const dir = this.resolveSessionDirectory(sessionId);
    const historyPath = join(dir, "history.json");
    writeJsonAtomically(historyPath, validated);
  }

  public getHistory(sessionId: string): StoredHistoryMessage[] {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), "history.json");
    } catch {
      return [];
    }
    if (!existsSync(file)) return [];
    try {
      const parsed = StoredHistorySchema.safeParse(
        JSON.parse(readFileSync(file, "utf8")),
      );
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  public deleteSession(id: string): void {
    SessionIdSchema.parse(id);
    const dir = this.resolveSessionDirectory(id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private createUniqueSessionDirectory(): {
    id: string;
    directory: string;
  } {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = generateId("sess");
      const directory = this.resolveSessionDirectory(id);
      try {
        mkdirSync(directory, { mode: PRIVATE_DIRECTORY_MODE });
        return { id, directory };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
    }
    throw new Error("Unable to allocate a unique Orbit session id.");
  }

  private resolveSessionRoot(): string {
    const sessionRoot = resolveSafePath(this.cwd, this.sessionRootPath);
    if (sessionRoot === this.cwd) {
      throw new Error("Orbit session root cannot be the workspace root.");
    }
    if (existsSync(sessionRoot)) {
      const rootStats = lstatSync(sessionRoot);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error("Orbit session root must be a real directory.");
      }
    }
    return sessionRoot;
  }

  private resolveSessionDirectory(id: string): string {
    const validId = SessionIdSchema.parse(id);
    const sessionRoot = this.resolveSessionRoot();
    const resolved = resolveSafePath(this.cwd, join(sessionRoot, validId));
    const relativePath = relative(sessionRoot, resolved);
    if (
      relativePath !== validId ||
      relativePath.includes(sep) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`Invalid session directory: ${id}`);
    }
    if (existsSync(resolved)) {
      const stats = lstatSync(resolved);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Invalid session directory: ${id}`);
      }
    }
    return resolved;
  }
}
