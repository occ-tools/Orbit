import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EditFileTool } from "./editFile.js";

describe("EditFileTool Fuzzy Hunk Merging Cascade", () => {
  let tempDir: string;
  let filePath: string;
  const tool = new EditFileTool();

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-edit-file-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    filePath = join(tempDir, "sample.txt");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should fallback to whitespace-insensitive matching and succeed", async () => {
    writeFileSync(filePath, "line1\n  line2  \nline3\n", "utf8");

    const result = await tool.execute(
      {
        path: "sample.txt",
        oldText: "line1\nline2\nline3",
        newText: "line1\nlineX\nline3",
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(filePath, "utf8");
    // It should replace while preserving surrounding spacing or simple formatting
    expect(content).toContain("lineX");
  });

  it("should adjust indentation dynamically based on the file content", async () => {
    // Indented with 4 spaces in file
    writeFileSync(filePath, "class Test {\n    constructor() {}\n}", "utf8");

    const result = await tool.execute(
      {
        path: "sample.txt",
        // old/new text is formatted with 2 spaces
        oldText: "class Test {\n  constructor() {}\n}",
        newText: "class Test {\n  constructor() {}\n  init() {}\n}",
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(filePath, "utf8");
    // The newly inserted line should have 4 spaces indentation, matching the file!
    expect(content).toBe(
      "class Test {\n    constructor() {}\n    init() {}\n}",
    );
  });

  it("should match using Levenshtein distance when similarity is above 80%", async () => {
    writeFileSync(
      filePath,
      'import { a } from "module";\n// some comments\nconst x = 10;\nexport default x;',
      "utf8",
    );

    const result = await tool.execute(
      {
        path: "sample.txt",
        // Has slightly different comment and missing export line
        oldText:
          'import { a } from "module";\n// different comment\nconst x = 10;',
        newText:
          'import { a } from "module";\n// different comment\nconst x = 20;',
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("const x = 20;");
  });

  it("should fail if Levenshtein similarity is below 80%", async () => {
    writeFileSync(filePath, "const x = 10;\nconst y = 20;", "utf8");

    const result = await tool.execute(
      {
        path: "sample.txt",
        oldText: "const z = 99;\nconst w = 88;",
        newText: "const z = 100;",
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Could not find target content");
  });
});
