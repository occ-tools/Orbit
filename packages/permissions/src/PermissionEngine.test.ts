import { describe, it, expect } from "vitest";
import { PermissionEngine } from "./PermissionEngine.js";
import { OrbitConfig } from "@orbit-build/config";

const mockConfig = (
  mode: "strict" | "normal" | "auto" | "plan",
): OrbitConfig => ({
  schemaVersion: 1,
  name: "test",
  provider: { default: "deepseek-openai" },
  models: {
    default: "foo",
    fast: "foo",
    planner: "foo",
    coder: "foo",
    reviewer: "foo",
    summarizer: "foo",
  },
  providers: {},
  permissions: {
    mode,
    allowRead: true,
    requireApprovalForWrite: true,
    requireApprovalForBash: true,
    blockDangerousCommands: true,
    protectSecrets: true,
    protectedPaths: [".env", "id_rsa"],
  },
  context: {
    maxFilesToIndex: 100,
    maxFileSizeKb: 10,
    ignore: [],
    autoCompact: false,
    compactThreshold: 0.8,
  },
  tools: {
    bash: { enabled: true, timeoutMs: 1000 },
    webSearch: { enabled: false },
    mcp: { enabled: false },
  },
  session: { store: "sqlite", path: "foo.db" },
});

describe("PermissionEngine tests", () => {
  it("should allow read tools in all modes", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    const decision = engine.evaluate("read_file", { path: "src/main.ts" });
    expect(decision.action).toBe("allow");
  });

  it("should require prompt for write tools in normal/strict modes", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    const decision = engine.evaluate("write_file", {
      path: "src/main.ts",
      content: "hello",
    });
    expect(decision.action).toBe("ask");
  });

  it("should block dangerous operations under normal/strict/auto modes", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    const decision = engine.evaluate("bash", { command: "rm -rf /" });
    expect(decision.action).toBe("deny");
  });

  it("should block access to protected files under strict mode, but prompt under normal", () => {
    const strictEngine = new PermissionEngine(mockConfig("strict"));
    const normalEngine = new PermissionEngine(mockConfig("normal"));

    expect(strictEngine.evaluate("read_file", { path: ".env" }).action).toBe(
      "deny",
    );
    expect(normalEngine.evaluate("read_file", { path: ".env" }).action).toBe(
      "ask",
    );
  });

  it("should classify write aliases as write operations", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    expect(
      engine.evaluate("replace_file_content", {
        TargetFile: "src/main.ts",
      }).action,
    ).toBe("ask");
    expect(
      engine.evaluate("multi_replace_file_content", {
        filePath: "src/main.ts",
      }).action,
    ).toBe("ask");
  });

  it("should recognize Windows destructive and network commands", () => {
    const engine = new PermissionEngine(mockConfig("auto"));
    expect(
      engine.evaluate("bash", {
        command: "Remove-Item .\\build -Recurse -Force",
      }).action,
    ).toBe("deny");
    expect(
      engine.evaluate("bash", {
        command: "Invoke-WebRequest https://example.com",
      }).action,
    ).toBe("ask");
  });

  it("should treat web search as a network operation", () => {
    const normalEngine = new PermissionEngine(mockConfig("normal"));
    const strictEngine = new PermissionEngine(mockConfig("strict"));

    expect(
      normalEngine.evaluate("web_search", { query: "Orbit docs" }, "network")
        .action,
    ).toBe("ask");
    expect(
      strictEngine.evaluate("web_search", { query: "Orbit docs" }, "network")
        .action,
    ).toBe("deny");
  });

  it("honors approval flags even in auto mode", () => {
    const config = mockConfig("auto");
    const engine = new PermissionEngine(config);

    expect(engine.evaluate("write_file", { path: "src/main.ts" }).action).toBe(
      "ask",
    );
    expect(engine.evaluate("bash", { command: "npm test" }).action).toBe("ask");
  });

  it("classifies a custom run_tests command using bash safety rules", () => {
    const config = mockConfig("auto");
    config.permissions.requireApprovalForBash = false;
    const engine = new PermissionEngine(config);

    expect(engine.evaluate("run_tests", { command: "rm -rf /" }).action).toBe(
      "deny",
    );
  });

  it("honors read and secret protection flags", () => {
    const config = mockConfig("auto");
    config.permissions.allowRead = false;
    expect(
      new PermissionEngine(config).evaluate("read_file", { path: "README.md" })
        .action,
    ).toBe("deny");

    config.permissions.allowRead = true;
    config.permissions.protectSecrets = false;
    expect(
      new PermissionEngine(config).evaluate("read_file", { path: ".env" })
        .action,
    ).toBe("allow");
  });

  it("handles malformed tool arguments without crashing", () => {
    const engine = new PermissionEngine(mockConfig("normal"));

    expect(engine.evaluate("read_file", null).action).toBe("allow");
    expect(engine.evaluate("bash", "not-an-object").action).toBe("ask");
  });
});
