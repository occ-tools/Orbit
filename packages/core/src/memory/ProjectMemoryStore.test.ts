import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProjectMemoryStore } from "./ProjectMemoryStore.js";

describe("ProjectMemoryStore", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-memory-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("does not write during construction and persists explicit memories", () => {
    const store = new ProjectMemoryStore(cwd);
    expect(existsSync(join(cwd, ".orbit"))).toBe(false);
    const entry = store.add("Use pnpm for this project");
    expect(store.read().entries).toEqual([entry]);
  });

  it("redacts credentials before persistence and supports review deletion", () => {
    const store = new ProjectMemoryStore(cwd);
    const entry = store.add("API_KEY=sk-12345678901234567890 use staging");
    const raw = readFileSync(join(cwd, ".orbit", "memory.json"), "utf8");
    expect(raw).not.toContain("sk-12345678901234567890");
    expect(store.remove(entry.id)).toBe(true);
    expect(store.read().entries).toHaveLength(0);
  });
});
