import { dirname, join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { z } from "zod";

const inputHistorySchema = z.array(z.string());

/** Persists submitted TUI inputs independently from terminal lifecycle state. */
export class InputHistoryStore {
  public constructor(
    private readonly filePath = join(homedir(), ".orbit", "input_history.json"),
  ) {}

  /** Loads validated history, degrading to an empty list for missing/corrupt data. */
  public load(): string[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      const result = inputHistorySchema.safeParse(parsed);
      return result.success ? result.data : [];
    } catch {
      return [];
    }
  }

  /** Saves history atomically enough for this single-process local cache. */
  public save(history: readonly string[]): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(history, null, 2), "utf8");
    } catch {
      // Input history is a convenience cache; terminal input must remain usable.
    }
  }
}
