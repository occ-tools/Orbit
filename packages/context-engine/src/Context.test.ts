import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ContextPackBuilder } from "./ContextPackBuilder.js";

describe("ContextPackBuilder tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-context-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should load project instructions and summarize relevant files", async () => {
    writeFileSync(
      join(tempDir, "README.md"),
      "# Test Project Instruction",
      "utf8",
    );
    writeFileSync(join(tempDir, "src.js"), 'console.log("hello");', "utf8");

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([
      { path: "src.js", reason: "Initial entry" },
    ]);

    expect(pack.projectInstructions).toContain("Test Project Instruction");
    expect(pack.relevantFiles.length).toBe(1);
    expect(pack.relevantFiles[0].path).toBe("src.js");
    expect(pack.relevantFiles[0].excerpt).toContain('console.log("hello");');
  });

  it("should index skills and load matching skill instructions on demand", async () => {
    const skillDir = join(tempDir, ".orbit", "skills", "api-tuning");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(tempDir, "orbit.config.yaml"),
      "skills:\n  directories:\n    - .orbit/skills\n  maxSkillBytes: 512\n",
      "utf8",
    );
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: api-tuning",
        "description: Optimize OpenAI compatible provider throughput",
        "---",
        "",
        "Use streaming and short retry backoff for API gateways.",
      ].join("\n"),
      "utf8",
    );

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "please use $api-tuning");

    expect(pack.skillsIndex?.map((skill) => skill.name)).toContain(
      "api-tuning",
    );
    expect(pack.activeSkills?.[0].content).toContain("short retry backoff");
    expect(pack.activeSkills?.[0].activation).toBe("explicit");
    expect(pack.activeSkills?.[0].truncated).toBe(false);
  });

  it("loads auto-triggered skills with a smaller budget", async () => {
    const skillDir = join(tempDir, ".orbit", "skills", "api-tuning");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(tempDir, "orbit.config.yaml"),
      "skills:\n  directories:\n    - .orbit/skills\n  maxSkillBytes: 512\n",
      "utf8",
    );
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: api-tuning",
        "description: Optimize OpenAI compatible provider throughput",
        "---",
        "",
        "Use streaming and short retry backoff for API gateways.",
        "This extra guidance should be truncated for automatic activation.",
        "Extended automatic guidance. ".repeat(80),
      ].join("\n"),
      "utf8",
    );

    const builder = new ContextPackBuilder(tempDir);
    const pack = await builder.build([], "optimize provider throughput");

    expect(pack.activeSkills?.[0].activation).toBe("auto");
    expect(pack.activeSkills?.[0].loadedBytes).toBeLessThanOrEqual(512);
    expect(pack.activeSkills?.[0].truncated).toBe(true);
  });

  it("honors maxAutoSkillBytes when selecting automatic skills", () => {
    const builder = new ContextPackBuilder(tempDir);
    const active = (builder as any).selectActiveSkills(
      [
        {
          name: "api-tuning",
          description: "provider throughput",
          path: ".orbit/skills/api-tuning/SKILL.md",
          content: "Use streaming. ".repeat(200),
        },
      ],
      "optimize provider throughput",
      {
        activation: "auto",
        maxActive: 3,
        maxSkillBytes: 4096,
        maxAutoSkillBytes: 512,
      },
    );

    expect(active[0].activation).toBe("auto");
    expect(active[0].loadedBytes).toBeLessThanOrEqual(512);
    expect(active[0].truncated).toBe(true);
  });
});
