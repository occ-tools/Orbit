#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runConfig } from "./commands/config.js";
import { runDoctor } from "./commands/doctor.js";
import { runAgent } from "./commands/run.js";
import { runLSPServer } from "./commands/LSPServer.js";

const program = new Command();

program
  .name("orbit")
  .description("Orbit - Local AI Coding Agent Runtime")
  .version("0.1.0")
  .argument("[task]", "task description for Orbit to execute")
  .option("--provider <provider>", "specify model provider")
  .option("--model <model>", "specify model name")
  .option("--yes", "bypass low-risk approvals")
  .option("--multi", "run in multi-agent planning/coding/review mode")
  .option("--direct", "run interactive REPL in direct console streaming mode")
  .action(async (task, options) => {
    const cwd = process.cwd();
    const overrides: any = {};
    if (options.provider) {
      overrides.provider = { default: options.provider };
    }
    if (options.model) {
      overrides.models = { default: options.model };
    }
    if (options.direct) {
      overrides.direct = true;
    }
    await runAgent(cwd, task, overrides, !!options.multi);
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
  .command("doctor")
  .description("diagnose local environment and API configs")
  .action(() => {
    runDoctor(process.cwd());
  });

program
  .command("lsp")
  .description("start the local LSP autocomplete server")
  .action(async () => {
    await runLSPServer(process.cwd());
  });

program.parse(process.argv);
