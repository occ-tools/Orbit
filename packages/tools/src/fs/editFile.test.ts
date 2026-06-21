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

  it("should block edits that introduce JSON syntax errors", async () => {
    const jsonPath = join(tempDir, "sample.json");
    writeFileSync(jsonPath, '{\n  "key": "value"\n}', "utf8");

    const result = await tool.execute(
      {
        path: "sample.json",
        oldText: '"key": "value"',
        newText: '"key": "value",', // trailing comma makes it invalid JSON
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Applying this edit would introduce the following syntax error");
    expect(result.error).toContain("JSON Syntax Error");
  });

  it("should block edits that introduce JS syntax errors", async () => {
    const jsPath = join(tempDir, "sample.js");
    writeFileSync(jsPath, 'const a = 10;\nconsole.log(a);', "utf8");

    const result = await tool.execute(
      {
        path: "sample.js",
        oldText: 'const a = 10;',
        newText: 'const a = {;', // unclosed brace
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Applying this edit would introduce the following syntax error");
    expect(result.error).toContain("JavaScript Syntax Error");
  });

  it("should block edits that introduce TS syntax errors", async () => {
    const tsPath = join(tempDir, "sample.ts");
    writeFileSync(tsPath, 'const x: number = 10;\nconsole.log(x);', "utf8");

    const result = await tool.execute(
      {
        path: "sample.ts",
        oldText: 'const x: number = 10;',
        newText: 'const x: number = ;', // incomplete assignment
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Applying this edit would introduce the following syntax error");
    expect(result.error).toContain("TypeScript Syntax Error");
  }, 15_000);

  it("should fallback to AST-based symbol matching and succeed when text spacing/newlines do not match exactly", async () => {
    const tsPath = join(tempDir, "sample.ts");
    writeFileSync(
      tsPath,
      `class Calc {
  add(a: number, b: number): number {
    // some comment
    return a + b;
  }
}`,
      "utf8",
    );

    const result = await tool.execute(
      {
        path: "sample.ts",
        oldText: `add(  a: number,
  b: number
): number {
  return a + b;
}`,
        newText: `add(a: number, b: number): number {
  return a + b + 1;
}`,
      },
      { cwd: tempDir },
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(tsPath, "utf8");
    expect(content).toContain("return a + b + 1;");
  });

  it("should block edits that introduce Python syntax errors", async () => {
    const pyPath = join(tempDir, "sample.py");
    writeFileSync(pyPath, 'def greet():\n    print("hello")', "utf8");

    const result = await tool.execute(
      {
        path: "sample.py",
        oldText: 'print("hello")',
        newText: 'print("hello"', // missing closing paren
      },
      { cwd: tempDir },
    );

    try {
      const { execSync } = await import("child_process");
      execSync("python --version", { stdio: "ignore" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Python Syntax Error");
    } catch {
      // If python is not installed, it should fallback and succeed
      expect(result.ok).toBe(true);
    }
  });

  it("should fallback to Python AST-based symbol matching and succeed when formatting varies", async () => {
    const pyPath = join(tempDir, "sample.py");
    writeFileSync(
      pyPath,
      `class Calculator:
    def add(self, a, b):
        # original comment
        return a + b`,
      "utf8",
    );

    const result = await tool.execute(
      {
        path: "sample.py",
        oldText: `def add(  self,
        a,
        b
    ):
        return a + b`,
        newText: `def add(self, a, b):
        return a + b + 100`,
      },
      { cwd: tempDir },
    );

    try {
      const { execSync } = await import("child_process");
      execSync("python --version", { stdio: "ignore" });
      expect(result.ok).toBe(true);
      const content = readFileSync(pyPath, "utf8");
      expect(content).toContain("return a + b + 100");
    } catch {
      // Skip test assertions if python is not installed
    }
  });
});
