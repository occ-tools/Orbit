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
import { runTraceExport } from "./commands/trace.js";
import { runEval } from "./commands/eval.js";
import { readCliVersion } from "./runtime/CliVersion.js";
import { existsSync, realpathSync, statSync } from "fs";
import { resolve } from "path";

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
  .description("manage secure provider logins and model catalogs")
  .option("--list", "list saved provider logins")
  .option("--delete <provider>", "delete a saved provider login")
  .option("--service <provider>", "configure a provider profile")
  .option("--name <name>", "set the provider display name")
  .option(
    "--base-url <url>",
    "set the exact API base URL (include /v1 when required)",
  )
  .option("--no-activate", "save without making this provider active")
  .action(async (options) => {
    await runLogin({
      list: !!options.list,
      deleteProvider: options.delete,
      provider: options.service,
      name: options.name,
      baseUrl: options.baseUrl,
      activate: options.activate,
    });
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
  .option(
    "--max-first-delta-ms <ms>",
    "fail when p90 first model delta exceeds this latency",
  )
  .option(
    "--max-first-text-ms <ms>",
    "fail when p90 first answer exceeds this latency",
  )
  .option(
    "--min-throughput <tokensPerSecond>",
    "fail when p50 decode throughput is below this rate",
  )
  .option(
    "--max-error-rate <ratio>",
    "fail when sample error rate exceeds a ratio or percentage",
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
      maxFirstDeltaMs: options.maxFirstDeltaMs,
      maxFirstTextMs: options.maxFirstTextMs,
      minThroughput: options.minThroughput,
      maxErrorRate: options.maxErrorRate,
      json: !!options.json,
    });
  });

program
  .command("eval")
  .description("run a task-level coding acceptance suite in isolated worktrees")
  .argument("<suite>", "YAML or JSON acceptance suite inside the workspace")
  .option("--provider <provider>", "provider override for every task")
  .option("--model <model>", "model override for every task")
  .option("--task <id>", "run one task from the suite")
  .option(
    "--allow-commands",
    "run the suite's reviewed verification commands inside worktrees",
  )
  .option("--json", "print the versioned evaluation report as JSON")
  .action(async (suite, localOptions, command) => {
    const options = command.optsWithGlobals();
    await runEval(process.cwd(), suite, {
      provider: localOptions.provider || options.provider,
      model: localOptions.model || options.model,
      task: localOptions.task,
      allowCommands: !!localOptions.allowCommands,
      json: !!localOptions.json,
    });
  });

program
  .command("trace")
  .description("export a redacted, versioned session audit trace")
  .argument("<session>", "session id to export")
  .option("--full", "include redacted conversation history")
  .option("--out <path>", "write inside the workspace instead of stdout")
  .action((session, options) => {
    const output = runTraceExport(process.cwd(), session, {
      full: !!options.full,
      out: options.out,
    });
    if (output) console.log(`Trace exported to ${output}`);
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
  .option("--cwd <path>", "open a specific project directory")
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
    const requestedCwd = resolve(localOptions.cwd || process.cwd());
    if (!existsSync(requestedCwd) || !statSync(requestedCwd).isDirectory()) {
      throw new Error(
        `Web UI project directory does not exist: ${requestedCwd}`,
      );
    }
    // Windows can hand us an 8.3 short path (for example through %TEMP%).
    // libuv's recursive watcher expects the watched root and event paths to
    // use the same canonical spelling, otherwise the process can abort.
    const cwd = realpathSync.native(requestedCwd);
    const outcome = await runAgent(cwd, undefined, overrides, false, {
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
  .option("--resume <session>", "resume a persisted Orbit session")
  .option("--jsonl", "output event logs in JSONL format")
  .action(async (prompt, localOptions, command) => {
    // Commander may store options shared with the root command on the parent
    // even when they appear after `exec`; always consume the merged view.
    const options = { ...command.optsWithGlobals(), ...localOptions };
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
      resumeSessionId: options.resume,
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
