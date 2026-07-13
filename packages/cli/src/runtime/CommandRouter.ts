import {
  AgentLoop,
  eventBus,
  Orchestrator,
  type AgentLoopRunOutcome,
  UserInteraction,
} from "@orbit-build/core";
import { FullscreenTui } from "../tui/FullscreenTui.js";
import { ConfigSchema } from "@orbit-build/config";
import { Prompt } from "@orbit-build/tui";
import picocolors from "picocolors";
import { existsSync } from "fs";
import { join } from "path";
import {
  expandCustomCommand,
  loadCustomCommands,
} from "../commands/customCommands.js";
import {
  formatModelOptionLabel,
  getProviderModelCandidates,
} from "./ModelCatalog.js";
import { createRequire } from "module";
import { buildDoctorReport } from "../commands/doctor.js";
import {
  parseWebUiArgs,
  startOrbitWebUi,
  type WebUiSettingsPatch,
} from "./webui/index.js";
import { RunCoordinator } from "./RunCoordinator.js";
import {
  BUILTIN_SLASH_COMMANDS,
  buildSlashCommandHelp,
} from "./SlashCommandCatalog.js";
import { getAutocompleteCandidates } from "./AutocompleteCandidates.js";
import { handleShellCommand } from "./commands/ShellCommandHandler.js";
import { handleWorkspaceConfigCommand } from "./commands/WorkspaceConfigCommandHandler.js";
import { handleContextCommand } from "./commands/ContextCommandHandler.js";
import { handleRollbackCommand } from "./commands/RollbackCommandHandler.js";
import { handleSessionCommand } from "./commands/SessionCommandHandler.js";

export { getAutocompleteCandidates } from "./AutocompleteCandidates.js";
export { BUILTIN_SLASH_COMMANDS } from "./SlashCommandCatalog.js";

const require = createRequire(import.meta.url);

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export class CommandRouter {
  private readonly runCoordinator = new RunCoordinator();
  private webUiRunnable: AgentLoop | Orchestrator | null = null;

  constructor(
    private cwd: string,
    private config: any,
    private providerInstance: any,
    private setProviderInstance: (newProvider: any) => void,
    private loop: AgentLoop,
    private tui: FullscreenTui,
    private useFullscreenTui: boolean,
    private getCandidates: () => any,
    private setCandidates: (candidates: any) => void,
    private getLocalState: () => any,
    private saveLocalState: (state: any) => void,
    private tuiInteraction: UserInteraction,
    private multi?: boolean,
  ) {}

  /** Acquires the shared agent loop for a terminal turn. */
  public beginTerminalRun(): (() => void) | undefined {
    return this.runCoordinator.acquire("terminal");
  }

  /** Reports whether the browser currently owns the shared agent loop. */
  public isWebUiBusy(): boolean {
    return this.runCoordinator.isActive("web");
  }

  private printOutput(text: string, raw = false) {
    if (this.tui && this.tui.isActive) {
      this.tui.addSystemMessage(text, raw);
    } else {
      console.log(text);
    }
    eventBus.emitEvent("info", { message: stripAnsi(text) });
  }

  public async route(
    input: string,
  ): Promise<{ shouldExit: boolean; processed: boolean }> {
    let trimmed = input.trim();
    if (!trimmed) return { shouldExit: false, processed: false };

    const useFullscreenTui = this.useFullscreenTui;
    const tui = this.tui;
    const config = this.config;
    const loop = this.loop;
    const cwd = this.cwd;

    if (trimmed.startsWith("/")) {
      const commandName = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
      const customCommand = loadCustomCommands(
        cwd,
        BUILTIN_SLASH_COMMANDS,
      ).find((candidate) => candidate.name === commandName);
      if (customCommand) {
        const rawArguments = trimmed.slice(commandName.length + 1).trim();
        trimmed = expandCustomCommand(customCommand, rawArguments);
        tui.addLog(
          `${config.language === "zh" ? "已展开自定义命令" : "Expanded custom command"} /${customCommand.name}`,
        );
      }
    }

    const shellResult = await handleShellCommand(trimmed, {
      cwd,
      config,
      loop,
      tui,
      useFullscreenTui,
    });
    if (shellResult) return shellResult;

    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(" ");
      const command = parts[0].toLowerCase();

      const contextResult = await handleContextCommand(
        command,
        parts.slice(1).join(" ").trim(),
        {
          cwd,
          language: config.language,
          candidates: this.getCandidates(),
          loop,
          tui,
          useFullscreenTui,
          printOutput: (text, raw) => this.printOutput(text, raw),
        },
      );
      if (contextResult) return contextResult;

      const rollbackResult = await handleRollbackCommand(
        command,
        parts.slice(1).join(" ").trim(),
        {
          cwd,
          language: config.language,
          loop,
          printOutput: (text, raw) => this.printOutput(text, raw),
        },
      );
      if (rollbackResult) return rollbackResult;

      if (command === "/exit" || command === "/quit") {
        this.printOutput(
          picocolors.yellow("Exiting Orbit Interactive Shell. Goodbye!"),
        );
        return { shouldExit: true, processed: true };
      }

      if (command === "/help") {
        this.printOutput(buildSlashCommandHelp(config.language === "zh"));
        return { shouldExit: false, processed: true };
      }

      if (command === "/webui") {
        const isZh = config.language === "zh";
        const { port, open } = parseWebUiArgs(parts.slice(1).join(" "));
        try {
          const handle = await startOrbitWebUi({
            cwd,
            config,
            loop,
            port,
            open,
            submitPrompt: (prompt) => this.submitWebPrompt(prompt),
            cancelPrompt: () => this.cancelWebPrompt(),
            updateSettings: (patch) => this.updateWebUiSettings(patch),
          });
          const displayUrl = new URL(handle.url);
          displayUrl.hash = "";
          this.printOutput(
            isZh
              ? picocolors.green(`✔ Orbit Web UI 已启动: ${displayUrl.href}`)
              : picocolors.green(`✔ Orbit Web UI running: ${displayUrl.href}`),
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.printOutput(
            isZh
              ? picocolors.red(`✖ 无法启动 Orbit Web UI: ${message}`)
              : picocolors.red(`✖ Failed to start Orbit Web UI: ${message}`),
          );
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/update") {
        const isZh = config.language === "zh";
        const wasActive = useFullscreenTui && tui.isActive;

        // 1. Check if package.json exists
        const packageJsonPath = join(cwd, "package.json");
        if (!existsSync(packageJsonPath)) {
          this.printOutput(
            isZh
              ? picocolors.yellow(
                  "当前工作区没有检测到 package.json，不支持 npm 更新。",
                )
              : picocolors.yellow(
                  "No package.json found in the workspace. npm update not supported.",
                ),
          );
          return { shouldExit: false, processed: true };
        }

        // 2. Determine command to use
        let installCmd = "npm install";
        if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
          installCmd = "pnpm install";
        } else if (existsSync(join(cwd, "yarn.lock"))) {
          installCmd = "yarn install";
        } else if (existsSync(join(cwd, "bun.lockb"))) {
          installCmd = "bun install";
        }

        if (wasActive) tui.stop();

        try {
          const approved = await Prompt.askApproval(
            isZh
              ? `检测到项目依赖需要更新，是否运行 "${installCmd}"？`
              : `NPM dependencies need update. Run "${installCmd}"?`,
          );

          if (approved) {
            console.log(picocolors.cyan(`\n● Running "${installCmd}"...`));
            const { execSync } = await import("child_process");
            execSync(installCmd, { cwd, stdio: "inherit" });
            console.log(
              picocolors.green(`✔ Dependencies updated successfully.\n`),
            );

            // Force clear TUI's cached npm check status so the heart turns red immediately
            (tui as any).npmNeedsUpdate = false;
            (tui as any).lastNpmCheckTime = Date.now();
          } else {
            console.log(picocolors.yellow(`\n✖ Update cancelled by user.\n`));
          }
        } catch (err: any) {
          console.log(picocolors.red(`\n✖ Update failed: ${err.message}\n`));
        } finally {
          tui.syncFromLoop(loop);
          if (wasActive) tui.start(config.budgetLimit);
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/status") {
        const isZh = config.language === "zh";
        const activeConfig = loop.getConfig();
        const activeModel =
          loop.getModelOverride() || activeConfig.models.default;
        const budgetLimit = activeConfig.budgetLimit;
        const currentCost = loop.getSessionCost();
        const mode = activeConfig.permissions.mode;
        const costPct =
          budgetLimit > 0
            ? Math.min(100, (currentCost / budgetLimit) * 100).toFixed(1)
            : "N/A";
        const barLen = 24;
        const filledLen =
          budgetLimit > 0
            ? Math.round((currentCost / budgetLimit) * barLen)
            : 0;
        const bar =
          picocolors.green("█".repeat(filledLen)) +
          picocolors.gray("░".repeat(Math.max(0, barLen - filledLen)));

        const statusLines = isZh
          ? [
              picocolors.bold("会话概况"),
              "",
              `  🆔  ${picocolors.gray("Session ID")}    ${picocolors.cyan(loop.getSessionId())}`,
              `  🔌  ${picocolors.gray("Provider")}      ${picocolors.cyan(this.providerInstance.id)}`,
              `  🤖  ${picocolors.gray("Active Model")}  ${picocolors.cyan(activeModel)}`,
              `  🛡️  ${picocolors.gray("Security Mode")} ${picocolors.green(mode.toUpperCase())}`,
              "",
              picocolors.bold("费用与预算"),
              "",
              `  💰  $${picocolors.yellow(currentCost.toFixed(4))} / $${picocolors.gray(budgetLimit.toFixed(2))}  (${costPct}%)`,
              `       ${bar}`,
            ]
          : [
              picocolors.bold("Session Overview"),
              "",
              `  🆔  ${picocolors.gray("Session ID")}    ${picocolors.cyan(loop.getSessionId())}`,
              `  🔌  ${picocolors.gray("Provider")}      ${picocolors.cyan(this.providerInstance.id)}`,
              `  🤖  ${picocolors.gray("Active Model")}  ${picocolors.cyan(activeModel)}`,
              `  🛡️  ${picocolors.gray("Security Mode")} ${picocolors.green(mode.toUpperCase())}`,
              "",
              picocolors.bold("Budget & Cost"),
              "",
              `  💰  $${picocolors.yellow(currentCost.toFixed(4))} / $${picocolors.gray(budgetLimit.toFixed(2))}  (${costPct}%)`,
              `       ${bar}`,
            ];

        this.printOutput(statusLines.join("\n"));
        return { shouldExit: false, processed: true };
      }

      if (command === "/doctor") {
        this.printOutput(buildDoctorReport(cwd, loop.getConfig()));
        return { shouldExit: false, processed: true };
      }

      if (command === "/config") {
        return handleWorkspaceConfigCommand(parts.slice(1).join(" ").trim(), {
          getConfig: () => loop.getConfig(),
          printOutput: (text, raw) => this.printOutput(text, raw),
        });
      }

      if (command === "/model") {
        const modelArg = parts.slice(1).join(" ").trim();
        const activeConfig = loop.getConfig();
        if (!modelArg) {
          const activeModel =
            loop.getModelOverride() || activeConfig.models.default;
          const providerId = this.providerInstance.id;
          const modelOptions: Array<{ value: string; label: string }> =
            getProviderModelCandidates(activeConfig, providerId).map(
              (model) => ({
                value: model,
                label: formatModelOptionLabel(model),
              }),
            );

          modelOptions.push({
            value: "custom",
            label: "Custom model name...",
          });
          modelOptions.push({ value: "cancel", label: "Cancel" });

          const selectedModel = await Prompt.askSelect(
            `Current model: ${activeModel}. Select a model to switch:`,
            modelOptions,
          );
          if (!selectedModel || selectedModel === "cancel") {
            return { shouldExit: false, processed: true };
          }
          let finalModel = selectedModel;
          if (selectedModel === "custom") {
            const customModel = await Prompt.askText(
              "Enter custom model name:",
            );
            if (!customModel) {
              return { shouldExit: false, processed: true };
            }
            finalModel = customModel;
            loop.setModelOverride(customModel);
            this.printOutput(
              `Switched active model to: ${picocolors.green(customModel)}`,
            );
          } else {
            loop.setModelOverride(selectedModel);
            this.printOutput(
              `Switched active model to: ${picocolors.green(selectedModel)}`,
            );
          }
          this.saveLocalState({ lastModel: finalModel });
          return { shouldExit: false, processed: true };
        }

        loop.setModelOverride(modelArg);
        this.printOutput(
          `Switched active model to: ${picocolors.green(modelArg)}`,
        );
        this.saveLocalState({ lastModel: modelArg });
        return { shouldExit: false, processed: true };
      }

      if (command === "/commit") {
        const commitMsg = parts.slice(1).join(" ").trim();
        const isZh = config.language === "zh";
        const { execFileSync, execSync } = await import("child_process");
        try {
          let diff = execSync("git diff --cached", { cwd }).toString().trim();
          if (!diff) {
            const unstaged = execSync("git status --porcelain", { cwd })
              .toString()
              .trim();
            if (!unstaged) {
              this.printOutput(
                picocolors.yellow(
                  isZh
                    ? "工作区干净，没有检测到任何已暂存或未暂存的更改。"
                    : "Workspace clean. No staged or unstaged changes found to commit.",
                ),
              );
              return { shouldExit: false, processed: true };
            }

            const autoStage = await Prompt.askApproval(
              isZh
                ? "未检测到已暂存的修改，是否自动暂存工作区中的所有变更并生成提交？"
                : "No staged changes found. Automatically stage all local changes and create a commit?",
            );

            if (!autoStage) {
              this.printOutput(
                picocolors.yellow(
                  isZh
                    ? "操作已取消。请先运行 'git add' 暂存你的修改。"
                    : "Operation cancelled. Please run 'git add' to stage your changes first.",
                ),
              );
              return { shouldExit: false, processed: true };
            }

            this.printOutput(
              isZh ? "正在暂存所有变更..." : "Staging all changes...",
            );
            execSync("git add -A", { cwd });
            diff = execSync("git diff --cached", { cwd }).toString().trim();
            if (!diff) {
              this.printOutput(
                picocolors.red(
                  isZh
                    ? "✖ 暂存失败或暂存后仍无变更。"
                    : "✖ Staging failed or resulted in no diff.",
                ),
              );
              return { shouldExit: false, processed: true };
            }
          }

          let finalMsg = commitMsg;
          if (!finalMsg) {
            this.printOutput("Generating commit message via LLM...");
            const fastModel = config.models.fast || config.models.default;
            const stream = this.providerInstance.chat({
              model: fastModel,
              messages: [
                {
                  id: `msg_commit_cmd_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [
                    {
                      type: "text",
                      text: `Generate a concise, high-quality conventional git commit message (e.g. feat(cli): add autocomplete) for the following git diff. Output ONLY the commit message, no formatting, no markdown, no quotes, just the text:\n\n${diff.substring(0, 20000)}`,
                    },
                  ],
                },
              ],
              tools: [],
            });

            let generatedMessage = "";
            for await (const event of stream) {
              if (event.type === "text_delta") {
                generatedMessage += event.text;
              }
            }
            finalMsg = generatedMessage.trim().replace(/^["']|["']$/g, "");
            if (!finalMsg) {
              finalMsg = "chore: auto-commit";
            }
          }

          this.printOutput(
            `Committing changes with message: "${picocolors.green(finalMsg)}"`,
          );
          execFileSync("git", ["commit", "-m", finalMsg], { cwd });
          this.printOutput(
            picocolors.green("✔ Git commit created successfully."),
          );
        } catch (err: any) {
          this.printOutput(picocolors.red(`✖ Commit failed: ${err.message}`));
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/chat") {
        return handleSessionCommand(parts[1], parts.slice(2).join(" ").trim(), {
          language: config.language,
          providerId: this.providerInstance.id,
          defaultModel: config.models.default,
          useFullscreenTui,
          loop,
          tui,
          printOutput: (text, raw) => this.printOutput(text, raw),
          saveLocalState: (state) => this.saveLocalState(state),
          refreshCandidates: async () => {
            tui.setCandidates(await getAutocompleteCandidates(cwd, config));
          },
        });
      }

      if (command === "/mode") {
        const isZh = config.language === "zh";
        const targetMode = parts.slice(1).join(" ").trim().toLowerCase();
        const currentMode = loop.getConfig().permissions.mode;

        const modeDescriptions: Record<string, string> = isZh
          ? {
              strict: "Strict  — 所有工具调用必须逐一确认",
              normal: "Normal  — 写入/执行操作需要确认",
              auto: "Auto    — 完全自动执行，仅阻止危险操作",
              plan: "Plan    — 规划模式，无实际文件修改",
            }
          : {
              strict: "Strict  — Confirm every tool call before execution",
              normal: "Normal  — Confirm write/exec operations only",
              auto: "Auto    — Fully autonomous, blocks dangerous cmds only",
              plan: "Plan    — Planning mode, no actual file changes",
            };

        if (!targetMode) {
          // No arg: show interactive overlay picker
          if (useFullscreenTui && tui.isActive) {
            const question = isZh
              ? `当前模式: ${picocolors.cyan(currentMode.toUpperCase())}\n\n选择新的安全模式:`
              : `Current mode: ${picocolors.cyan(currentMode.toUpperCase())}\n\nSelect a security mode:`;
            const choice = await Prompt.askSelect(question, [
              { value: "strict", label: modeDescriptions.strict },
              { value: "normal", label: modeDescriptions.normal },
              { value: "auto", label: modeDescriptions.auto },
              { value: "plan", label: modeDescriptions.plan },
            ]);
            if (choice && choice !== currentMode) {
              loop.getConfig().permissions.mode = choice as any;
              tui.syncFromLoop(loop);
            }
          } else {
            this.printOutput(
              isZh
                ? picocolors.yellow("用法: /mode <strict|normal|auto|plan>")
                : picocolors.yellow("Usage: /mode <strict|normal|auto|plan>"),
            );
          }
          return { shouldExit: false, processed: true };
        }

        const validModes = ["strict", "normal", "auto", "plan"];
        if (!validModes.includes(targetMode)) {
          this.printOutput(
            isZh
              ? picocolors.red(
                  `✖ 无效的安全模式: ${targetMode}。可选模式: ${validModes.join(", ")}`,
                )
              : picocolors.red(
                  `✖ Invalid security mode: ${targetMode}. Valid modes: ${validModes.join(", ")}`,
                ),
          );
          return { shouldExit: false, processed: true };
        }

        loop.getConfig().permissions.mode = targetMode as any;
        tui.syncFromLoop(loop);
        if (useFullscreenTui && tui.isActive) {
          const msg = isZh
            ? `当前模式: ${picocolors.cyan(currentMode.toUpperCase())}\n\n${picocolors.green("✔")} 已切换安全模式至: ${picocolors.green(targetMode.toUpperCase())}`
            : `Previous mode: ${picocolors.cyan(currentMode.toUpperCase())}\n\n${picocolors.green("✔")} Switched security mode to: ${picocolors.green(targetMode.toUpperCase())}`;
          await Prompt.askSelect(msg, [
            { value: "ok", label: isZh ? "返回对话" : "Return to Chat" },
          ]);
        } else {
          this.printOutput(
            isZh
              ? picocolors.green(
                  `✔ 已切换安全模式至: ${targetMode.toUpperCase()}`,
                )
              : picocolors.green(
                  `✔ Switched security mode to: ${targetMode.toUpperCase()}`,
                ),
          );
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/copy") {
        const isZh = config.language === "zh";
        const history = loop.getHistory();
        const lastAssistantMsg = [...history]
          .reverse()
          .find((msg) => msg.role === "assistant");

        if (!lastAssistantMsg) {
          this.printOutput(
            isZh
              ? picocolors.yellow("没有找到 AI 的最近回复。")
              : picocolors.yellow(
                  "No recent assistant response found to copy.",
                ),
          );
          return { shouldExit: false, processed: true };
        }

        let textToCopy = "";
        if (typeof lastAssistantMsg.content === "string") {
          textToCopy = lastAssistantMsg.content;
        } else if (Array.isArray(lastAssistantMsg.content)) {
          textToCopy = lastAssistantMsg.content
            .map((c: any) => (c.type === "text" ? c.text : ""))
            .join("");
        }

        if (!textToCopy) {
          this.printOutput(
            isZh
              ? picocolors.yellow("AI 的最近回复内容为空。")
              : picocolors.yellow("Recent assistant response is empty."),
          );
          return { shouldExit: false, processed: true };
        }

        const copied = this.copyToClipboard(textToCopy);
        if (copied) {
          this.printOutput(
            isZh
              ? picocolors.green("✔ 已成功复制 AI 最近回复到剪贴板！")
              : picocolors.green(
                  "✔ Successfully copied recent AI response to clipboard!",
                ),
          );
        } else {
          this.printOutput(
            isZh
              ? picocolors.red(
                  "✖ 复制到剪贴板失败，系统未配置剪贴板工具（如 pbcopy/clip/xclip）。",
                )
              : picocolors.red(
                  "✖ Failed to copy to clipboard. Ensure pbcopy/clip/xclip is installed.",
                ),
          );
        }
        return { shouldExit: false, processed: true };
      }

      this.printOutput(
        picocolors.red(
          `Unknown command: ${trimmed}. Type /help for available commands.`,
        ),
      );
      return { shouldExit: false, processed: true };
    }

    return { shouldExit: false, processed: false };
  }

  private async submitWebPrompt(
    prompt: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return { ok: false, message: "Prompt is empty." };
    }
    if (this.tui.hasActiveRunnable()) {
      return {
        ok: false,
        message: "Orbit is already processing a Web UI request.",
      };
    }

    const releaseRun = this.runCoordinator.acquire("web");
    if (!releaseRun) {
      return {
        ok: false,
        message: "Orbit is already processing another request.",
      };
    }
    try {
      const routeResult = await this.route(trimmed);
      if (routeResult.processed) {
        return { ok: true };
      }

      this.loop.prepareUserTurn(trimmed);
      this.saveLocalState({
        lastSessionId: this.loop.getSessionId(),
        lastModel: this.loop.getModelOverride() || this.config.models.default,
      });

      let runnable: AgentLoop | Orchestrator = this.loop;
      if (this.multi) {
        runnable = new Orchestrator(
          this.cwd,
          this.config,
          this.providerInstance,
          trimmed,
          this.tuiInteraction,
        );
      }

      this.tui.setActiveRunnable(runnable);
      this.webUiRunnable = runnable;
      let outcome: AgentLoopRunOutcome;
      try {
        outcome = await runnable.run();
      } finally {
        if (this.webUiRunnable === runnable) this.webUiRunnable = null;
        this.tui.setActiveRunnable(null);
        this.tui.syncFromLoop(this.loop);
        this.tui.finishAttempt();
      }
      if (outcome.status === "failed") {
        return { ok: false, message: outcome.error.message };
      }
      if (outcome.status === "aborted") {
        return { ok: false, message: outcome.message };
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    } finally {
      releaseRun();
    }
  }

  private cancelWebPrompt(): { ok: boolean; message?: string } {
    if (!this.runCoordinator.isActive("web") || !this.webUiRunnable) {
      return { ok: false, message: "Nothing is currently running." };
    }
    this.webUiRunnable.abort("immediate");
    return { ok: true };
  }

  private async updateWebUiSettings(
    patch: WebUiSettingsPatch,
  ): Promise<{ ok: boolean; message?: string }> {
    const draft = JSON.parse(JSON.stringify(this.config));
    if (patch.permissionMode) {
      draft.permissions.mode = patch.permissionMode;
    }
    if (typeof patch.webSearchEnabled === "boolean") {
      draft.tools.webSearch.enabled = patch.webSearchEnabled;
    }
    if (patch.webSearchProvider) {
      draft.tools.webSearch.provider = patch.webSearchProvider;
    }
    if (typeof patch.webSearchMaxResults === "number") {
      draft.tools.webSearch.maxResults = patch.webSearchMaxResults;
    }

    const parsed = ConfigSchema.safeParse(draft);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message };
    }

    if (patch.model) {
      this.loop.setModelOverride(patch.model);
      this.saveLocalState({ lastModel: patch.model });
    }
    if (patch.permissionMode) {
      this.config.permissions.mode = patch.permissionMode;
      this.tui.setPermissionsMode(patch.permissionMode);
    }
    if (typeof patch.webSearchEnabled === "boolean") {
      this.config.tools.webSearch.enabled = patch.webSearchEnabled;
    }
    if (patch.webSearchProvider) {
      this.config.tools.webSearch.provider = patch.webSearchProvider;
    }
    if (typeof patch.webSearchMaxResults === "number") {
      this.config.tools.webSearch.maxResults = patch.webSearchMaxResults;
    }

    return { ok: true };
  }

  private copyToClipboard(text: string): boolean {
    const { execSync } = require("child_process");
    try {
      if (process.platform === "win32") {
        execSync("clip", { input: text });
        return true;
      } else if (process.platform === "darwin") {
        execSync("pbcopy", { input: text });
        return true;
      } else {
        try {
          execSync("xclip -selection clipboard", { input: text });
          return true;
        } catch {
          try {
            execSync("xsel -ib", { input: text });
            return true;
          } catch {
            try {
              execSync("wl-copy", { input: text });
              return true;
            } catch {
              return false;
            }
          }
        }
      }
    } catch {
      return false;
    }
  }
}
