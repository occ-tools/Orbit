#!/usr/bin/env node
import { Command } from "commander";
import picocolors from "picocolors";
import { redactSecrets } from "@orbit-build/shared";
import { runInit } from "./commands/init.js";
import { runConfig } from "./commands/config.js";
import { runDoctor } from "./commands/doctor.js";
import { parseBenchOptions, runBench } from "./commands/bench.js";
import { exitCodeForOutcome, runAgent } from "./commands/run.js";
import { runLSPServer } from "./commands/LSPServer.js";
import { runLogin } from "./commands/login.js";
import { readCliVersion } from "./runtime/CliVersion.js";

const program = new Command();

function applyOutcomeExitCode(
  outcome: Awaited<ReturnType<typeof runAgent>>,
): void {
  const currentExitCode =
    typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = Math.max(currentExitCode, exitCodeForOutcome(outcome));
}

program
  .name("orbit")
  .description("Orbit - Local AI Coding Agent Runtime")
  .version(readCliVersion())
  .argument("[task]", "task description for Orbit to execute")
  .option("--provider <provider>", "specify model provider")
  .option("--model <model>", "specify model name")
  .option("--yes", "bypass low-risk approvals")
  .option("--multi", "run in multi-agent planning/coding/review mode")
  .option("--direct", "run interactive REPL in direct console streaming mode")
  .action(async (task, options) => {
    const cwd = process.cwd();
    const overrides: Record<string, unknown> = {};
    if (options.provider) {
      overrides.provider = { default: options.provider };
    }
    if (options.model) {
      overrides.models = { default: options.model };
    }
    if (options.direct) {
      overrides.direct = true;
    }
    if (options.yes) {
      overrides.permissions = { mode: "auto" };
    }
    const outcome = await runAgent(cwd, task, overrides, !!options.multi);
    applyOutcomeExitCode(outcome);
  });

program
  .command("init")
  .description("initialize ORBIT.md guidelines file")
  .action(() => {
    runInit(process.cwd());
  });

program
  .command("config")
  .description("show resolved configurations")
  .action(() => {
    runConfig(process.cwd());
  });

program
  .command("login")
  .description("interactively configure API keys for models")
  .action(async () => {
    await runLogin();
  });

program
  .command("doctor")
  .description("diagnose local environment and API configs")
  .option("--probe", "perform a lightweight live provider capability probe")
  .option(
    "--deepseek",
    "include DeepSeek V4 endpoint, model, alias, and cache diagnostics",
  )
  .option("--json", "print a redacted machine-readable diagnostic snapshot")
  .option("--strict", "return a non-zero status for warnings or errors")
  .action(async (options) => {
    await runDoctor(process.cwd(), {
      probe: !!options.probe,
      deepseek: !!options.deepseek,
      json: !!options.json,
      strict: !!options.strict,
    });
  });

program
  .command("bench")
  .description(
    "measure first model/answer latency, decode throughput, and cache telemetry",
  )
  .option("--provider <provider>", "provider id to benchmark")
  .option("--model <model>", "model to benchmark")
  .option("--models <models>", "comma-separated models to benchmark")
  .option("--prompt <prompt>", "custom benchmark prompt")
  .option(
    "--repeat <n>",
    "samples to record: 1-20 (default: 1; cache profile minimum: 3)",
  )
  .option(
    "--max-tokens <n>",
    "completion cap: 1-16384 (defaults: disabled=256, high=4096, max=8192)",
  )
  .option(
    "--cache-profile",
    "run a repeated stable-prefix DeepSeek cache profile (minimum 3 samples)",
  )
  .option(
    "--thinking <mode>",
    "thinking mode: disabled, high, or max (Flash/cache default disabled; Pro default high)",
  )
  .option(
    "--min-cache-hit <ratio>",
    "fail when repeated-sample average cache hit is below ratio, e.g. 0.75 or 75",
  )
  .option("--json", "print benchmark samples as JSON")
  .action(async (_localOptions, command) => {
    // Commander stores options shared with the parent command (notably
    // --model and --provider) on the parent even when they appear after
    // `bench`. Read the merged view so an explicit benchmark model wins over
    // the configured fast-model fallback.
    const options = parseBenchOptions(command.optsWithGlobals());
    await runBench(process.cwd(), {
      provider: options.provider,
      model: options.model,
      models: options.models,
      prompt: options.prompt,
      repeat: options.repeat,
      maxTokens: options.maxTokens,
      cacheProfile: !!options.cacheProfile,
      thinking: options.thinking,
      minCacheHit: options.minCacheHit,
      json: !!options.json,
    });
  });

program
  .command("lsp")
  .description("start the local LSP autocomplete server")
  .action(async () => {
    await runLSPServer(process.cwd());
  });

program
  .command("webui")
  .description("start Orbit as a browser-first local coding workspace")
  .option("--port <port>", "preferred loopback port (default: 6047)")
  .option("--no-open", "start without opening the default browser")
  .action(async (localOptions, command) => {
    const options = command.optsWithGlobals();
    const rawPort = localOptions.port;
    const port = rawPort === undefined ? undefined : Number(rawPort);
    if (
      port !== undefined &&
      (!Number.isInteger(port) || port < 0 || port > 65535)
    ) {
      throw new Error("Web UI port must be an integer from 0 to 65535.");
    }
    const overrides: Record<string, unknown> = { direct: true };
    if (options.provider) {
      overrides.provider = { default: options.provider };
    }
    if (options.model) {
      overrides.models = { default: options.model };
    }
    if (options.yes) {
      overrides.permissions = { mode: "auto" };
    }
    const outcome = await runAgent(process.cwd(), undefined, overrides, false, {
      webUi: { port, open: localOptions.open !== false },
    });
    applyOutcomeExitCode(outcome);
  });

program
  .command("exec")
  .description("run a task in non-interactive mode and stream events as JSONL")
  .argument("<prompt>", "the task prompt to execute")
  .option("--provider <provider>", "specify model provider")
  .option("--model <model>", "specify model name")
  .option("--jsonl", "output event logs in JSONL format")
  .action(async (prompt, _localOptions, command) => {
    // Commander may store options shared with the root command on the parent
    // even when they appear after `exec`; always consume the merged view.
    const options = command.optsWithGlobals();
    const cwd = process.cwd();
    const overrides: Record<string, unknown> = {};
    if (options.provider) {
      overrides.provider = { default: options.provider };
    }
    if (options.model) {
      overrides.models = { default: options.model };
    }
    const outcome = await runAgent(cwd, prompt, overrides, false, {
      nonInteractive: true,
      jsonl: !!options.jsonl,
    });
    applyOutcomeExitCode(outcome);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    picocolors.red(`✖ Orbit command failed: ${redactSecrets(message)}`),
  );
  process.exitCode = 1;
}
