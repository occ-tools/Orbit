import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildCacheProfilePrompt, parseBenchOptions } from "./bench.js";

describe("bench CLI options", () => {
  it("preserves model and provider options inherited from the root command", () => {
    const program = new Command();
    let resolvedOptions: ReturnType<typeof parseBenchOptions> | undefined;

    program.option("--provider <provider>").option("--model <model>");
    program
      .command("bench")
      .option("--provider <provider>")
      .option("--model <model>")
      .action((_localOptions, command) => {
        resolvedOptions = parseBenchOptions(command.optsWithGlobals());
      });

    program.parse([
      "node",
      "orbit",
      "bench",
      "--provider",
      "deepseek-openai",
      "--model",
      "deepseek-v4-pro",
    ]);

    expect(resolvedOptions).toMatchObject({
      provider: "deepseek-openai",
      model: "deepseek-v4-pro",
    });
  });
});

describe("bench cache profile prompt", () => {
  it("keeps a cache-sized prefix when a custom workload is supplied", () => {
    const prompt = buildCacheProfilePrompt(
      "run-stable",
      "Write twelve optimization tips.",
    );

    expect(prompt.length).toBeGreaterThan(20_000);
    expect(prompt).toContain("Cache profile run: run-stable");
    expect(prompt).toContain("Write twelve optimization tips.");
    expect(
      buildCacheProfilePrompt("run-stable", "Write twelve optimization tips."),
    ).toBe(prompt);
  });

  it("uses a unique prefix across separate benchmark invocations", () => {
    expect(buildCacheProfilePrompt("run-a")).not.toBe(
      buildCacheProfilePrompt("run-b"),
    );
  });
});
