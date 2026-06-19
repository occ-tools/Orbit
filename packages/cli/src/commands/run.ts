import {
  ConfigLoader,
  ConfigSchema,
  CredentialsManager,
} from "@orbit-ai/config";
import {
  AgentLoop,
  UserInteraction,
  Orchestrator,
  eventBus,
  AutocompleteEngine,
} from "@orbit-ai/core";
import { resolveSafePath } from "@orbit-ai/shared";
import http from "http";
import {
  DeepSeekAnthropicProvider,
  DeepSeekOpenAIProvider,
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
} from "@orbit-ai/model-providers";
import { Prompt, DiffView, Renderer } from "@orbit-ai/tui";
import picocolors from "picocolors";
import glob from "fast-glob";
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "fs";
import { join, dirname } from "path";
import readline from "readline";
import { SymbolIndexer } from "@orbit-ai/context-engine";
import { execSync } from "child_process";

async function pageText(text: string): Promise<void> {
  const lines = text.split("\n");
  const rows = process.stdout.rows || 24;
  const pageSize = rows - 2;

  if (lines.length <= pageSize) {
    console.log(text);
    return;
  }

  let cursor = 0;
  const wasRaw = !!process.stdin.isRaw;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  readline.emitKeypressEvents(process.stdin);

  const keypressPromise = (): Promise<string> => {
    return new Promise((resolve) => {
      const onKeypress = (str: string, key: any) => {
        process.stdin.removeListener("keypress", onKeypress);
        if (key && key.ctrl && key.name === "c") {
          if (process.stdin.setRawMode) {
            process.stdin.setRawMode(wasRaw);
          }
          process.exit(0);
        }
        resolve(key ? key.name || str : str);
      };
      process.stdin.on("keypress", onKeypress);
    });
  };

  try {
    while (cursor < lines.length) {
      const chunk = lines.slice(cursor, cursor + pageSize);
      console.log(chunk.join("\n"));
      cursor += pageSize;

      if (cursor >= lines.length) {
        break;
      }

      process.stdout.write(
        `\r\x1b[36m-- More (${Math.round((cursor / lines.length) * 100)}%) [Space/Enter to continue, q to quit] --\x1b[39m`,
      );

      const key = await keypressPromise();
      process.stdout.write("\r\x1b[K");

      if (key === "q") {
        break;
      }
      if (key === "return" || key === "enter") {
        cursor = cursor - pageSize + 1;
      }
    }
  } finally {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(wasRaw);
    }
    process.stdin.pause();
  }
}

class FullscreenTui {
  private history: Array<{
    role: "user" | "assistant" | "system";
    text: string;
    thoughtTime?: number; // ms
    totalTime?: number; // ms
    attempt?: number;
  }> = [];

  private inputBuffer = "";
  private cursorPosition = 0;
  private isActive = false;
  private currentAttempt = 0;

  // Command history
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private tempBuffer = "";
  private activeCommandIndex = 0;
  private ctrlCPressedOnce = false;
  private ctrlCTimeout: NodeJS.Timeout | null = null;
  private cachedStaticLinesCount = 0;
  private cachedStaticContent = "";
  private lastRenderedBottomHeight = 0;

  // DeepSeek real-time thinking
  private currentThinking = "";

  // Timers and metrics
  private attemptStartTime = 0;
  private firstDeltaTime = 0;
  private thoughtTimer: NodeJS.Timeout | null = null;
  private thoughtElapsed = 0;
  private isThinking = false;

  private sessionCost = 0;
  private budgetLimit = 0;

  private resolveInput: ((val: string | null) => void) | null = null;

  // Throttled rendering to prevent terminal flickering during model output
  private lastRenderTime = 0;
  private renderPending = false;
  private renderTimeout: NodeJS.Timeout | null = null;

  private originalWrite = process.stdout.write.bind(process.stdout);
  private hasWrittenStdoutSinceStop = false;

  private candidates: {
    commands: string[];
    files: string[];
    symbols: string[];
  } | null = null;
  private modelNameGetter: () => string = () => this.modelName;
  private permissionsMode = "normal";
  private hideAutocomplete = false;

  public setPermissionsMode(mode: string) {
    this.permissionsMode = mode;
  }

  public setModelNameGetter(getter: () => string) {
    this.modelNameGetter = getter;
  }

  constructor(
    private cwd: string,
    private modelName: string,
    private version: string,
  ) {
    readline.emitKeypressEvents(process.stdin);
    process.stdout.write = (chunk: any, encoding?: any, cb?: any) => {
      if (!this.isActive) {
        const text = typeof chunk === "string" ? chunk : chunk.toString();
        if (text.trim().length > 0) {
          this.hasWrittenStdoutSinceStop = true;
        }
      }
      return this.originalWrite(chunk, encoding, cb);
    };
  }

  public setCandidates(candidates: any) {
    this.candidates = candidates;
  }

  private onResize = () => {
    if (this.isActive) {
      this.render(true);
    }
  };

  public start(budgetLimit: number) {
    this.budgetLimit = budgetLimit;
    this.isActive = true;
    this.hasWrittenStdoutSinceStop = false;
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    process.stdout.on("resize", this.onResize);
    this.render();
  }

  public stop() {
    if (!this.isActive) return;
    this.isActive = false;
    process.stdout.off("resize", this.onResize);
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    this.hasWrittenStdoutSinceStop = false;
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    this.renderPending = false;
  }

  private getSuggestion(): string {
    if (!this.candidates || !this.inputBuffer.startsWith("/")) return "";
    const line = this.inputBuffer;
    const matches = this.candidates.commands.filter((c) => c.startsWith(line));
    if (matches.length > 0) {
      const idx = Math.min(this.activeCommandIndex, matches.length - 1);
      const match = matches[idx];
      if (match && match !== line) {
        return match.substring(line.length);
      }
    }
    return "";
  }

  private getHits(): { hits: string[]; lastWord: string } {
    if (!this.candidates || !this.inputBuffer.startsWith("/"))
      return { hits: [], lastWord: "" };
    const line = this.inputBuffer;
    const hits = this.candidates.commands.filter((c) => c.startsWith(line));
    return { hits, lastWord: line };
  }

  public setCost(cost: number) {
    this.sessionCost = cost;
    this.render();
  }

  public handleThinkingDelta(text: string) {
    this.currentThinking += text;
    this.throttleRender();
  }

  public addLog(text: string) {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    if (
      trimmed.includes("Summary:") ||
      trimmed.includes("Modified files:") ||
      trimmed.includes("Verification:") ||
      trimmed.includes("Session Cost:")
    ) {
      return;
    }
    if (text.includes("Orbit:")) {
      const cleanText = text.replace(/Orbit:\s*/i, "").trim();
      const last = this.history[this.history.length - 1];
      if (last && last.role === "assistant") {
        if (!last.text.includes(cleanText)) {
          last.text = cleanText;
        }
        this.render();
      }
      return;
    }
    if (text.includes("Thought")) {
      return;
    }

    this.history.push({
      role: "system",
      text: trimmed,
    });
    this.render();
  }

  public syncFromLoop(loop: any) {
    const loopHistory = loop.getHistory();
    if (loopHistory.length === 0) return;

    let localAsstIdx = this.history
      .map((m, i) => (m.role === "assistant" ? i : -1))
      .filter((i) => i !== -1);
    let loopAsst = loopHistory.filter((m: any) => m.role === "assistant");

    for (let i = 0; i < loopAsst.length; i++) {
      const loopMsg = loopAsst[i];
      const textBlock = loopMsg.content.find((b: any) => b.type === "text");
      if (textBlock && textBlock.text) {
        const localIdx = localAsstIdx[i];
        if (localIdx !== undefined) {
          this.history[localIdx].text = textBlock.text;
        } else {
          this.history.push({
            role: "assistant",
            text: textBlock.text,
            attempt: i + 1,
          });
        }
      }
    }
    this.render();
  }

  public loadHistory(loopHistory: any[]) {
    this.history = [];
    let attempt = 0;
    for (const msg of loopHistory) {
      if (msg.role === "user") {
        const text = msg.content
          .map((c: any) => (c.type === "text" ? c.text : ""))
          .join("");
        if (text === "REPL Interactive Shell Started") {
          continue;
        }
        this.history.push({
          role: "user",
          text,
        });
      } else if (msg.role === "assistant") {
        attempt++;
        const textBlock = msg.content.find((b: any) => b.type === "text");
        this.history.push({
          role: "assistant",
          text: textBlock?.text || "",
          attempt,
        });
      } else if (msg.role === "system") {
        const text = msg.content
          .map((c: any) => (c.type === "text" ? c.text : ""))
          .join("");
        this.history.push({
          role: "system",
          text,
        });
      }
    }
    this.render();
  }

  public async askInput(): Promise<string | null> {
    if (!this.isActive) {
      if (this.hasWrittenStdoutSinceStop) {
        const wasRaw = !!process.stdin.isRaw;
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        await Prompt.askText("Press Enter to return to Orbit...");
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw);
        }
        this.hasWrittenStdoutSinceStop = false;
      }
      this.start(this.budgetLimit);
    }
    process.stdout.write("\x1b[?25h");

    return new Promise((resolve) => {
      this.resolveInput = resolve;
      this.inputBuffer = "";
      this.cursorPosition = 0;
      this.hideAutocomplete = false;
      this.render();

      const wasRaw = !!process.stdin.isRaw;
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onKeypress = (str: string, key: any) => {
        if (!this.isActive) {
          cleanup();
          return;
        }

        if (key && key.ctrl && key.name === "c") {
          this.activeCommandIndex = 0;
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = "";
            this.cursorPosition = 0;
            this.render();
          } else {
            if (this.ctrlCPressedOnce) {
              if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
              cleanup();
              this.stop();
              process.exit(0);
            } else {
              this.ctrlCPressedOnce = true;
              if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout);
              this.ctrlCTimeout = setTimeout(() => {
                this.ctrlCPressedOnce = false;
                this.render();
              }, 2000);
              this.render();
            }
          }
          return;
        }

        if (key && (key.name === "return" || key.name === "enter")) {
          cleanup();
          process.stdout.write("\x1b[?25l");
          const submitted = this.inputBuffer;
          this.resolveInput = null;

          if (submitted.trim()) {
            this.history.push({ role: "user", text: submitted });
            if (this.inputHistory[this.inputHistory.length - 1] !== submitted) {
              this.inputHistory.push(submitted);
            }
          }
          this.historyIndex = -1;
          this.inputBuffer = "";
          this.cursorPosition = 0;
          this.render();
          resolve(submitted);
          return;
        }

        if (key && key.name === "up") {
          if (this.inputBuffer.startsWith("/")) {
            const matches = this.candidates
              ? this.candidates.commands.filter((c) =>
                  c.startsWith(this.inputBuffer),
                )
              : [];
            if (matches.length > 0) {
              this.activeCommandIndex =
                (this.activeCommandIndex - 1 + matches.length) % matches.length;
              this.render();
              return;
            }
          }
          if (this.inputHistory.length > 0) {
            if (this.historyIndex === -1) {
              this.tempBuffer = this.inputBuffer;
              this.historyIndex = this.inputHistory.length - 1;
            } else if (this.historyIndex > 0) {
              this.historyIndex--;
            }
            this.inputBuffer = this.inputHistory[this.historyIndex];
            this.cursorPosition = this.inputBuffer.length;
            this.render();
          }
          return;
        }

        if (key && key.name === "down") {
          if (this.inputBuffer.startsWith("/")) {
            const matches = this.candidates
              ? this.candidates.commands.filter((c) =>
                  c.startsWith(this.inputBuffer),
                )
              : [];
            if (matches.length > 0) {
              this.activeCommandIndex =
                (this.activeCommandIndex + 1) % matches.length;
              this.render();
              return;
            }
          }
          if (this.historyIndex !== -1) {
            if (this.historyIndex < this.inputHistory.length - 1) {
              this.historyIndex++;
              this.inputBuffer = this.inputHistory[this.historyIndex];
            } else {
              this.historyIndex = -1;
              this.inputBuffer = this.tempBuffer || "";
            }
            this.cursorPosition = this.inputBuffer.length;
            this.render();
          }
          return;
        }

        if (key && key.name === "left") {
          if (this.cursorPosition > 0) {
            this.cursorPosition--;
            this.render();
          }
          return;
        }

        if (key && key.name === "right") {
          if (this.cursorPosition < this.inputBuffer.length) {
            this.cursorPosition++;
            this.render();
          } else {
            const sug = this.getSuggestion();
            if (sug) {
              this.inputBuffer += sug;
              this.cursorPosition = this.inputBuffer.length;
              this.render();
            }
          }
          return;
        }

        if (key && key.name === "tab") {
          if (this.inputBuffer.startsWith("/")) {
            const matches = this.candidates
              ? this.candidates.commands.filter((c) =>
                  c.startsWith(this.inputBuffer),
                )
              : [];
            if (matches.length > 0) {
              const idx = Math.min(this.activeCommandIndex, matches.length - 1);
              const match = matches[idx];
              if (match) {
                this.inputBuffer = match;
                this.cursorPosition = match.length;
                this.activeCommandIndex = 0;
                this.render();
              }
              return;
            }
          }
          const sug = this.getSuggestion();
          if (sug) {
            this.inputBuffer += sug;
            this.cursorPosition = this.inputBuffer.length;
            this.render();
          }
          return;
        }

        if (key && key.ctrl && key.name === "u") {
          this.activeCommandIndex = 0;
          this.inputBuffer = "";
          this.cursorPosition = 0;
          this.render();
          return;
        }

        if (key && key.ctrl && key.name === "w") {
          this.activeCommandIndex = 0;
          const beforeCursor = this.inputBuffer.substring(
            0,
            this.cursorPosition,
          );
          const afterCursor = this.inputBuffer.substring(this.cursorPosition);
          const parts = beforeCursor.trimEnd().split(/\s+/);
          parts.pop();
          const newBefore = parts.length > 0 ? parts.join(" ") + " " : "";
          this.inputBuffer = newBefore + afterCursor;
          this.cursorPosition = newBefore.length;
          this.render();
          return;
        }

        if (key && key.ctrl && key.name === "p") {
          this.activeCommandIndex = 0;
          if (!this.inputBuffer.startsWith("/")) {
            this.inputBuffer = "/" + this.inputBuffer;
            this.cursorPosition = this.inputBuffer.length;
          }
          this.render();
          return;
        }

        if (key && key.name === "delete") {
          this.activeCommandIndex = 0;
          this.hideAutocomplete = false;
          if (this.cursorPosition < this.inputBuffer.length) {
            this.inputBuffer =
              this.inputBuffer.substring(0, this.cursorPosition) +
              this.inputBuffer.substring(this.cursorPosition + 1);
            this.render();
          }
          return;
        }

        if (key && key.name === "backspace") {
          this.activeCommandIndex = 0;
          this.hideAutocomplete = false;
          if (this.cursorPosition > 0) {
            this.inputBuffer =
              this.inputBuffer.substring(0, this.cursorPosition - 1) +
              this.inputBuffer.substring(this.cursorPosition);
            this.cursorPosition--;
          }
        } else if (key && key.name === "escape") {
          this.activeCommandIndex = 0;
          this.hideAutocomplete = true;
        } else if (
          str &&
          (!key || (!key.ctrl && !key.meta && key.name !== "tab"))
        ) {
          this.activeCommandIndex = 0;
          this.hideAutocomplete = false;
          this.inputBuffer =
            this.inputBuffer.substring(0, this.cursorPosition) +
            str +
            this.inputBuffer.substring(this.cursorPosition);
          this.cursorPosition += str.length;
        }

        this.render();
      };

      const cleanup = () => {
        process.stdin.removeListener("keypress", onKeypress);
        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw);
        }
        process.stdin.pause();
      };

      process.stdin.on("keypress", onKeypress);
    });
  }

  public startAttempt(attempt: number) {
    this.currentAttempt = attempt;
    this.attemptStartTime = Date.now();
    this.firstDeltaTime = 0;
    this.isThinking = true;
    this.thoughtElapsed = 0;
    this.currentThinking = "";

    this.history.push({
      role: "assistant",
      text: "",
      attempt: attempt,
    });

    if (this.thoughtTimer) clearInterval(this.thoughtTimer);
    this.thoughtTimer = setInterval(() => {
      if (this.isThinking) {
        this.thoughtElapsed += 100;
        this.render();
      }
    }, 100);

    this.render();
  }

  public handleModelDelta(text: string) {
    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAsst) {
      if (this.isThinking && text.trim().length > 0) {
        this.isThinking = false;
        if (this.thoughtTimer) {
          clearInterval(this.thoughtTimer);
          this.thoughtTimer = null;
        }
        lastAsst.thoughtTime = Date.now() - this.attemptStartTime;
      }
      lastAsst.text += text;
      this.throttleRender();
    }
  }

  private throttleRender() {
    const now = Date.now();
    const minInterval = 20;
    if (now - this.lastRenderTime >= minInterval) {
      if (this.renderTimeout) {
        clearTimeout(this.renderTimeout);
        this.renderTimeout = null;
      }
      this.lastRenderTime = now;
      this.render();
    } else if (!this.renderPending) {
      this.renderPending = true;
      this.renderTimeout = setTimeout(
        () => {
          this.renderPending = false;
          this.lastRenderTime = Date.now();
          this.render();
        },
        minInterval - (now - this.lastRenderTime),
      );
    }
  }

  public finishAttempt() {
    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAsst) {
      this.isThinking = false;
      if (this.thoughtTimer) {
        clearInterval(this.thoughtTimer);
        this.thoughtTimer = null;
      }
      lastAsst.totalTime = Date.now() - this.attemptStartTime;
      if (lastAsst.thoughtTime === undefined) {
        lastAsst.thoughtTime = lastAsst.totalTime;
      }
      this.render();
    }
  }
  public render(forceFull = false) {
    const columns = Math.max(40, process.stdout.columns || 80);
    const rows = Math.max(10, process.stdout.rows || 24);

    const morandi = {
      user: (s: string) => `\x1b[38;2;142;163;175m${s}\x1b[0m`,
      userBold: (s: string) => `\x1b[1;38;2;142;163;175m${s}\x1b[0m`,
      asst: (s: string) => `\x1b[38;2;143;153;129m${s}\x1b[0m`,
      asstBold: (s: string) => `\x1b[1;38;2;143;153;129m${s}\x1b[0m`,
      cyan: (s: string) => `\x1b[38;2;142;163;175m${s}\x1b[0m`,
      accent: (s: string) => `\x1b[38;2;200;170;120m${s}\x1b[0m`,
      completed: (s: string) => `\x1b[38;2;135;165;130m${s}\x1b[0m`,
      failed: (s: string) => `\x1b[38;2;180;120;120m${s}\x1b[0m`,
      warn: (s: string) => `\x1b[38;2;180;140;130m${s}\x1b[0m`,
      white: (s: string) => `\x1b[38;2;230;225;215m${s}\x1b[0m`,
      whiteBold: (s: string) => `\x1b[1;38;2;230;225;215m${s}\x1b[0m`,
      gray: (s: string) => `\x1b[38;2;150;150;150m${s}\x1b[0m`,
      dim: (s: string) => `\x1b[2;38;2;110;110;110m${s}\x1b[0m`,
    };

    const isWaitingInput = this.resolveInput !== null;
    const hasInput = isWaitingInput && this.inputBuffer.length > 0;
    const placeholder = isWaitingInput ? "Ask anything..." : "";

    // A.1 构建底部的圆角输入框与状态行以及指令匹配浮窗
    const boxWidth = columns - 4;
    const wrapWidth = boxWidth - 14;
    const fullText = hasInput ? this.inputBuffer : placeholder;

    const wrappedLines = this.wrapText(fullText, wrapWidth);
    const formattedLines = hasInput
      ? this.formatWrappedLines(wrappedLines, this.inputBuffer.length)
      : wrappedLines.map((line) => morandi.dim(line));

    const boxContentLines: string[] = [];
    const topBorder = morandi.gray("  ╭" + "─".repeat(boxWidth - 4) + "╮");
    const bottomBorder = morandi.gray("  ╰" + "─".repeat(boxWidth - 4) + "╯");

    boxContentLines.push(topBorder);
    for (let i = 0; i < formattedLines.length; i++) {
      const prefix = i === 0 ? "orbit > " : "        ";
      const rawLine = wrappedLines[i];
      const visualWidth = this.getStringWidth(rawLine);
      const remainingSpaces = wrapWidth - visualWidth;
      const padding = " ".repeat(remainingSpaces);

      const lineContent =
        morandi.gray("  │ ") +
        morandi.userBold(prefix) +
        formattedLines[i] +
        padding +
        morandi.gray(" │");
      boxContentLines.push(lineContent);
    }
    boxContentLines.push(bottomBorder);

    const bottomLines: string[] = [];

    if (isWaitingInput) {
      // A.2 只有以 / 开头时，渲染指令下拉浮窗
      const matches =
        this.inputBuffer.startsWith("/") && !this.hideAutocomplete
          ? this.candidates
            ? this.candidates.commands.filter((c) =>
                c.startsWith(this.inputBuffer),
              )
            : []
          : [];

      if (matches.length > 0) {
        const cmdHints: Record<string, string> = {
          "/help": "帮助",
          "/status": "状态",
          "/config": "配置",
          "/model": "切换模型",
          "/chat": "切换/新建会话",
          "/commit": "提交代码",
          "/exit": "退出",
          "/quit": "退出",
          "/rollback": "回滚",
          "/clear": "清屏",
          "/compact": "压缩历史",
          "/history": "历史",
          "/edit": "编辑配置",
          "/inspect": "检查工作区",
          "/doc": "查看文档",
          "/diagnose": "诊断错误",
          "/resolve": "解决问题",
          "/references": "寻找引用",
          "/api": "测试API",
          "/register": "注册工具",
        };

        const maxVisible = 5;
        this.activeCommandIndex = Math.min(
          Math.max(0, this.activeCommandIndex),
          matches.length - 1,
        );

        let startIdx = 0;
        if (this.activeCommandIndex >= maxVisible) {
          startIdx = this.activeCommandIndex - maxVisible + 1;
        }
        const visibleMatches = matches.slice(startIdx, startIdx + maxVisible);

        const popupWidth = 36; // 浮窗边框内宽度
        bottomLines.push(morandi.gray("  ╭" + "─".repeat(popupWidth) + "╮"));
        for (let i = 0; i < visibleMatches.length; i++) {
          const matchIdx = startIdx + i;
          const cmd = visibleMatches[i];
          const isSelected = matchIdx === this.activeCommandIndex;
          const prefix = isSelected ? " ❯ " : "   ";

          const hint = cmdHints[cmd] || "";
          const leftPart = `${prefix}${cmd}`;
          const rightPart = hint ? `(${hint})` : "";

          const leftW = this.getStringWidth(leftPart);
          const rightW = this.getStringWidth(rightPart);
          const spacingWidth = Math.max(1, popupWidth - leftW - rightW);
          const spacing = " ".repeat(spacingWidth);

          const formattedLine = isSelected
            ? morandi.accent(leftPart + spacing) + morandi.dim(rightPart)
            : morandi.gray(leftPart + spacing) + morandi.dim(rightPart);

          bottomLines.push(
            morandi.gray("  │") + formattedLine + morandi.gray("│"),
          );
        }
        bottomLines.push(morandi.gray("  ╰" + "─".repeat(popupWidth) + "╯"));
      }

      // A.3 压入输入框
      bottomLines.push(...boxContentLines);

      // A.4 构建底部状态行
      const budgetPct =
        Math.min(
          100,
          Math.round((this.sessionCost / (this.budgetLimit || 10)) * 100),
        ) + "%";
      const mode = this.permissionsMode.toUpperCase();

      let statusText = "";
      if (this.ctrlCPressedOnce) {
        statusText = morandi.warn("Press Ctrl+C again to exit");
      } else {
        statusText =
          morandi.completed("●") +
          " " +
          morandi.white(`${mode} MODE`) +
          morandi.gray("  ·  ") +
          morandi.gray("attempt: ") +
          morandi.accent(`${this.currentAttempt || 1}`) +
          morandi.gray("  ·  ") +
          morandi.gray("cost: ") +
          morandi.completed(`$${this.sessionCost.toFixed(4)}`) +
          morandi.gray(` (${budgetPct})`);
      }

      const rightIndicator =
        morandi.gray("[ctrl+p]") + morandi.dim(" commands");

      const rightIndLength = rightIndicator.replace(
        /\x1b\[[0-9;]*[a-zA-Z]/g,
        "",
      ).length;
      const statusTextLength = statusText.replace(
        /\x1b\[[0-9;]*[a-zA-Z]/g,
        "",
      ).length;
      const spacing = Math.max(
        2,
        columns - 4 - statusTextLength - rightIndLength,
      );

      bottomLines.push(
        "  " + statusText + " ".repeat(spacing) + rightIndicator,
      );
    }

    const bottomHeight = bottomLines.length;

    // A.5 决策是否执行增量重绘
    const canIncremental =
      !forceFull &&
      this.resolveInput !== null &&
      this.cachedStaticLinesCount > 0 &&
      bottomHeight === this.lastRenderedBottomHeight;

    if (canIncremental) {
      // 局部增量渲染逻辑
      let cursorSequence = "";
      let tempLen = 0;
      let cursorLineIndex = 0;
      let xOffset = 0;
      for (let i = 0; i < wrappedLines.length; i++) {
        const line = wrappedLines[i];
        if (
          this.cursorPosition >= tempLen &&
          this.cursorPosition <= tempLen + line.length
        ) {
          cursorLineIndex = i;
          const subStr = line.substring(0, this.cursorPosition - tempLen);
          xOffset = this.getStringWidth(subStr);
          break;
        }
        tempLen += line.length;
      }
      const lineStartX =
        cursorLineIndex === 0 ? this.getStringWidth("  │ orbit > ") : 12;
      const targetX = lineStartX + xOffset;
      const linesUp = formattedLines.length - cursorLineIndex + 1; // 距离状态行向上数 linesUp 行
      cursorSequence = `\x1b[${linesUp}A\x1b[${targetX + 1}G\x1b[?25h`;

      const bottomOutput =
        "\x1b[?25l" + // 隐藏光标
        `\x1b[${this.cachedStaticLinesCount + 1};1H` + // 移至底部的首行
        bottomLines.map((line) => line + "\x1b[K").join("\n") +
        "\x1b[J" + // 擦拭并重写 bottomLines
        cursorSequence;

      process.stdout.write(bottomOutput);
      return;
    }

    // 全屏渲染逻辑（当无法增量时）
    const cleanModel = this.modelNameGetter().replace(/\[1m\]/g, "");

    // 1. 获取 Git 当前分支
    let gitBranch = "no-git";
    try {
      gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {}

    // 2. 渲染左上角像素行星 Logo 及其右侧信息
    const logoLines = [
      `\x1b[38;2;142;163;175m  /\\___/\\  \x1b[0m`,
      `\x1b[38;2;142;163;175m (  o.o  ) \x1b[0m`,
      `\x1b[38;2;142;163;175m  / >\x1b[38;2;230;110;110m♥\x1b[38;2;142;163;175m< \\  \x1b[0m`,
      `\x1b[38;2;142;163;175m (__/ \\__) \x1b[0m`,
    ];

    const w0 = this.getStringWidth(logoLines[0]);
    const w1 = this.getStringWidth(logoLines[1]);
    const w2 = this.getStringWidth(logoLines[2]);
    const w3 = this.getStringWidth(logoLines[3]);
    const maxLogoW = Math.max(w0, w1, w2, w3);

    const pad0 = " ".repeat(maxLogoW - w0);
    const pad1 = " ".repeat(maxLogoW - w1);
    const pad2 = " ".repeat(maxLogoW - w2);
    const pad3 = " ".repeat(maxLogoW - w3);

    const shortCwd = this.cwd.replace(/\\/g, "/");
    const branchText =
      gitBranch !== "no-git"
        ? `  ${morandi.dim("·")}  branch:${morandi.asst(gitBranch)}`
        : "";

    const headerLine1 = `  ${logoLines[0]}${pad0}  ${morandi.whiteBold("O R B I T")}  ${morandi.dim("·")}  ${morandi.accent(cleanModel)}`;
    const headerLine2 = `  ${logoLines[1]}${pad1}  ${morandi.dim("workspace:")} ${morandi.gray(shortCwd)}${branchText}`;
    const headerLine3 = `  ${logoLines[2]}${pad2}`;
    const headerLine4 = `  ${logoLines[3]}${pad3}`;

    // 3. 构建历史对话内容
    let renderedLines: string[] = [];

    interface TuiTurn {
      user: any;
      assistant?: any;
      system: any[];
    }

    const turns: TuiTurn[] = [];
    let currentTurn: TuiTurn | null = null;

    for (const msg of this.history) {
      if (msg.role === "user") {
        if (currentTurn) {
          turns.push(currentTurn);
        }
        currentTurn = { user: msg, system: [] };
      } else if (msg.role === "assistant") {
        if (currentTurn) {
          currentTurn.assistant = msg;
        }
      } else if (msg.role === "system") {
        if (currentTurn) {
          currentTurn.system.push(msg);
        }
      }
    }
    if (currentTurn) {
      turns.push(currentTurn);
    }

    const lastAsst = [...this.history]
      .reverse()
      .find((m) => m.role === "assistant");
    const uBorder = "   ";
    const aBorder = "   ";

    for (const turn of turns) {
      // Render User Turn
      renderedLines.push("  " + morandi.userBold("👤 User"));
      renderedLines.push(uBorder);

      const userLines = turn.user.text.split("\n");
      for (const line of userLines) {
        renderedLines.push(uBorder + morandi.user(line));
      }
      renderedLines.push(uBorder);
      renderedLines.push(""); // spacing

      // Render Assistant Turn
      if (turn.assistant) {
        const asstLines: string[] = [];
        const systemLines: string[] = [];

        for (const sys of turn.system) {
          let text = sys.text.trim();
          if (
            text.startsWith("✓ Success") ||
            text.startsWith("✖ Failed") ||
            text.startsWith("✔ Success")
          ) {
            continue;
          }
          if (text.startsWith("✔")) {
            text =
              morandi.completed("completed") + morandi.gray(text.substring(1));
          } else if (text.startsWith("✖")) {
            text = morandi.failed("failed") + morandi.gray(text.substring(1));
          } else if (text.startsWith("●")) {
            text = morandi.cyan("●") + morandi.gray(text.substring(1));
          } else if (text.startsWith("✦")) {
            text = morandi.cyan("✦") + morandi.gray(text.substring(1));
          } else if (text.startsWith("⚠")) {
            text = morandi.warn("⚠") + morandi.gray(text.substring(1));
          } else {
            text = morandi.cyan("✦") + " " + morandi.gray(text);
          }
          systemLines.push(text);
        }

        const isThinkingNow = turn.assistant === lastAsst && this.isThinking;
        const thoughtTimeVal = isThinkingNow
          ? this.thoughtElapsed
          : turn.assistant.thoughtTime;

        if (thoughtTimeVal !== undefined) {
          const timeStr =
            thoughtTimeVal >= 1000
              ? `${(thoughtTimeVal / 1000).toFixed(1)}s`
              : `${thoughtTimeVal}ms`;

          const breatheDots = [
            "\x1b[38;2;142;163;175m·\x1b[0m",
            "\x1b[38;2;143;153;129m•\x1b[0m",
            "\x1b[38;2;200;170;120m●\x1b[0m",
            "\x1b[38;2;135;165;130m•\x1b[0m",
          ];
          const spinIdx = Math.floor(Date.now() / 250) % 4;
          const dotChar = isThinkingNow
            ? breatheDots[spinIdx]
            : morandi.gray("•");

          asstLines.push(
            `${dotChar} ` + morandi.accent(`Thinking... ${timeStr}`),
          );

          if (isThinkingNow && this.currentThinking) {
            const lines = this.currentThinking.split("\n").filter(Boolean);
            const lastLines = lines.slice(-3);
            for (const line of lastLines) {
              const trimmed = line.trim();
              const maxLength = columns - 8;
              const truncated =
                trimmed.length > maxLength
                  ? trimmed.substring(0, maxLength - 3) + "..."
                  : trimmed;
              asstLines.push(morandi.gray(`  🧠 ${truncated}`));
            }
          }
        }

        if (systemLines.length > 0) {
          asstLines.push(...systemLines);
        }

        if (turn.assistant.text) {
          if (asstLines.length > 0) {
            asstLines.push("");
          }

          // Markdown Render Memoization 缓存与节流优化！
          const asstObj = turn.assistant as any;
          const isStreaming = this.resolveInput === null;
          const nowTime = Date.now();
          const timeSinceLastRender =
            nowTime - (asstObj._lastMarkdownRenderTime || 0);

          if (
            !asstObj._formattedCached ||
            asstObj._textCached !== turn.assistant.text
          ) {
            if (
              !isStreaming ||
              timeSinceLastRender >= 150 ||
              !asstObj._formattedCached
            ) {
              asstObj._formattedCached = Renderer.formatMarkdown(
                turn.assistant.text,
              ).split("\n");
              asstObj._textCached = turn.assistant.text;
              asstObj._lastMarkdownRenderTime = nowTime;
            }
          }
          asstLines.push(...asstObj._formattedCached);
        }

        let footerStatusLine = "";
        const lastSys = turn.system[turn.system.length - 1];
        if (lastSys && lastSys.text.includes("Failed")) {
          footerStatusLine = `${morandi.failed("failed")}  ·  ${morandi.dim(cleanModel)}`;
        } else if (turn.assistant.totalTime !== undefined) {
          const sec = (turn.assistant.totalTime / 1000).toFixed(1);
          footerStatusLine = `${morandi.completed("completed")}  ·  ${morandi.dim(cleanModel)}  ·  ${morandi.dim(sec + "s")}`;
        }

        if (footerStatusLine) {
          asstLines.push("");
          asstLines.push(footerStatusLine);
        }

        renderedLines.push("  " + morandi.asstBold(`🤖 Orbit (${cleanModel})`));
        renderedLines.push(aBorder);
        for (const line of asstLines) {
          renderedLines.push(aBorder + line);
        }
        renderedLines.push(aBorder);
        renderedLines.push("");
      }
    }

    // 6. 排版与渲染到终端 (带垂直裁剪逻辑，自底向上排布)
    const maxContentRows = Math.max(1, rows - bottomHeight - 7); // 预留头部 6 行 + 缓冲 1 行

    let flatLines: string[] = [];
    for (const item of renderedLines) {
      flatLines.push(...item.split("\n"));
    }

    let finalLines: string[] = [];
    let totalLinesCount = 0;

    for (let i = flatLines.length - 1; i >= 0; i--) {
      const line = flatLines[i];
      const visibleLen = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
      const lineRows = Math.max(
        1,
        Math.ceil(visibleLen / Math.max(1, columns - 4)),
      );
      if (totalLinesCount + lineRows > maxContentRows) {
        break;
      }
      totalLinesCount += lineRows;
      finalLines.unshift(line);
    }

    // 重新设计拼接结构，直接由三部分直接拼接，extraPad 用于在 Logo (header) 与历史对话 (content) 之间插入空行，将对话始终贴底。
    const headerText = `${headerLine1}\n${headerLine2}\n${headerLine3}\n${headerLine4}\n\n`; // 刚好 6 行
    const contentText =
      finalLines.join("\n") + (finalLines.length > 0 ? "\n" : "");
    const footerText = bottomLines.join("\n");

    const totalHeight = 6 + finalLines.length + bottomHeight;
    const extraPad = Math.max(0, rows - totalHeight - 1);

    const combinedOutput =
      headerText + "\n".repeat(extraPad) + contentText + footerText;
    const rawLines = combinedOutput.split("\n");

    // 缓存静态渲染信息
    this.cachedStaticLinesCount = rawLines.length - bottomHeight;
    this.cachedStaticContent = rawLines
      .slice(0, this.cachedStaticLinesCount)
      .join("\n");
    this.lastRenderedBottomHeight = bottomHeight;

    let finalOutput =
      "\x1b[?25l\x1b[H" +
      rawLines.map((line) => line + "\x1b[K").join("\n") +
      "\x1b[J";

    // 7. 相对光标精确定位与原子打包输出
    let cursorSequence = "";
    if (this.resolveInput) {
      let tempLen = 0;
      let cursorLineIndex = 0;
      let xOffset = 0;
      for (let i = 0; i < wrappedLines.length; i++) {
        const line = wrappedLines[i];
        if (
          this.cursorPosition >= tempLen &&
          this.cursorPosition <= tempLen + line.length
        ) {
          cursorLineIndex = i;
          const subStr = line.substring(0, this.cursorPosition - tempLen);
          xOffset = this.getStringWidth(subStr);
          break;
        }
        tempLen += line.length;
      }
      const lineStartX =
        cursorLineIndex === 0 ? this.getStringWidth("  │ orbit > ") : 12;
      const targetX = lineStartX + xOffset;
      const linesUp = formattedLines.length - cursorLineIndex + 1; // 距离状态行向上数 linesUp 行
      cursorSequence = `\x1b[${linesUp}A\x1b[${targetX + 1}G\x1b[?25h`;
    } else {
      cursorSequence = "\x1b[?25l";
    }

    finalOutput += cursorSequence;
    process.stdout.write(finalOutput);
  }

  private isFullWidth(codePoint: number): boolean {
    if (Number.isNaN(codePoint)) {
      return false;
    }
    if (
      codePoint === 0x276f || // ❯
      codePoint === 0x2665 || // ♥
      codePoint === 0x25e2 || // ◢
      codePoint === 0x25e3 || // ◣
      codePoint === 0x25e4 || // ◤
      codePoint === 0x25e5 || // ◥
      codePoint === 0x2590 || // ▐
      codePoint === 0x258c || // ▌
      codePoint === 0x25cf // ●
    ) {
      return true;
    }
    return (
      (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
      codePoint === 0x2329 || // LEFT-POINTING ANGLE BRACKET
      codePoint === 0x232a || // RIGHT-POINTING ANGLE BRACKET
      (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) || // CJK Radicals Supplement .. Enclosed CJK Letters and Months
      (codePoint >= 0x3250 && codePoint <= 0x4dbf) || // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
      (codePoint >= 0x4e00 && codePoint <= 0xa4c6) || // CJK Unified Ideographs .. Yi Radicals
      (codePoint >= 0xa960 && codePoint <= 0xa97c) || // Hangul Jamo Extended-A
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
      (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical Forms
      (codePoint >= 0xfe30 && codePoint <= 0xfe6b) || // CJK Compatibility Forms .. Small Form Variants
      (codePoint >= 0xff01 && codePoint <= 0xff60) || // Halfwidth and Fullwidth Forms
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1b000 && codePoint <= 0x1b001) || // Kana Supplement
      (codePoint >= 0x1f200 && codePoint <= 0x1f251) || // Enclosed Ideographic Supplement
      (codePoint >= 0x20000 && codePoint <= 0x3fffd) || // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
      (codePoint >= 0x1f300 && codePoint <= 0x1f9ff) || // Emojis
      (codePoint >= 0x1f600 && codePoint <= 0x1f64f) || // Emoticons
      (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) // Transport & Map
    );
  }

  private getStringWidth(str: string): number {
    let width = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.codePointAt(i);
      if (!code) continue;
      if (code > 0xffff) {
        i++;
      }
      if (this.isFullWidth(code)) {
        width += 2;
      } else {
        width += 1;
      }
    }
    return width;
  }

  private wrapText(str: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let currentLine = "";
    let currentWidth = 0;

    for (let i = 0; i < str.length; i++) {
      const code = str.codePointAt(i);
      if (!code) continue;
      let char = str.charAt(i);
      if (code > 0xffff) {
        char = str.substring(i, i + 2);
        i++;
      }
      const charWidth = this.isFullWidth(code) ? 2 : 1;
      if (currentWidth + charWidth > maxWidth) {
        lines.push(currentLine);
        currentLine = char;
        currentWidth = charWidth;
      } else {
        currentLine += char;
        currentWidth += charWidth;
      }
    }
    if (currentLine || lines.length === 0) {
      lines.push(currentLine);
    }
    return lines;
  }

  private formatWrappedLines(
    wrappedLines: string[],
    inputLength: number,
  ): string[] {
    let charIndex = 0;
    const formattedLines: string[] = [];

    for (const line of wrappedLines) {
      let formattedLine = "";
      for (let i = 0; i < line.length; i++) {
        const char = line.charAt(i);
        const code = line.codePointAt(i);
        let increment = 1;
        let charStr = char;
        if (code && code > 0xffff) {
          charStr = line.substring(i, i + 2);
          i++;
          increment = 2;
        }

        if (charIndex < inputLength) {
          formattedLine += `\x1b[1;38;2;230;225;215m${charStr}\x1b[0m`; // morandi.whiteBold
        } else {
          formattedLine += `\x1b[2;38;2;110;110;110m${charStr}\x1b[0m`; // morandi.dim
        }
        charIndex += increment;
      }
      formattedLines.push(formattedLine);
    }
    return formattedLines;
  }
}

interface LocalState {
  lastSessionId?: string;
  lastModel?: string;
}

function getLocalState(cwd: string): LocalState {
  const statePath = join(cwd, ".orbit", "state.json");
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function saveLocalState(cwd: string, state: LocalState): void {
  const statePath = join(cwd, ".orbit", "state.json");
  try {
    const dir = dirname(statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const current = getLocalState(cwd);
    const updated = { ...current, ...state };
    writeFileSync(statePath, JSON.stringify(updated, null, 2), "utf8");
  } catch {}
}

function startAutocompleteServer(cwd: string, config: any) {
  const engine = new AutocompleteEngine();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/autocomplete") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body);
          const prefix = parsed.prefix || "";
          const suffix = parsed.suffix || "";
          const completion = await engine.autocomplete(prefix, suffix, config);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ completion }));
        } catch (e: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  let port = 6018;
  const startListen = (p: number) => {
    server.listen(p, "127.0.0.1", () => {
      eventBus.emitEvent("info", {
        message: `Autocomplete bridge server running on http://127.0.0.1:${p}`,
      });
    });
    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        startListen(p + 1);
      }
    });
  };
  startListen(port);
}

export async function runAgent(
  cwd: string,
  task?: string,
  cliOverrides?: any,
  multi?: boolean,
): Promise<void> {
  const config = ConfigLoader.loadSync(cwd, cliOverrides);
  startAutocompleteServer(cwd, config);

  if (!cliOverrides || !cliOverrides.model) {
    const localState = getLocalState(cwd);
    if (localState.lastModel) {
      config.models.default = localState.lastModel;
    }
  }

  if (config.models) {
    if (config.models.default) {
      config.models.default = config.models.default.replace(/\[1m\]/g, "");
    }
    if (config.models.fast) {
      config.models.fast = config.models.fast.replace(/\[1m\]/g, "");
    }
  }

  const providerName = config.provider.default;
  const pConfig = config.providers[providerName];
  if (!pConfig) {
    console.error(
      picocolors.red(
        `Provider "${providerName}" is not defined in configuration.`,
      ),
    );
    return;
  }

  let providerInstance: any;
  if (pConfig.type === "anthropic-compatible") {
    providerInstance = new DeepSeekAnthropicProvider(
      pConfig.apiKey,
      pConfig.baseUrl,
    );
  } else if (pConfig.type === "openai-compatible") {
    providerInstance = new DeepSeekOpenAIProvider(
      pConfig.apiKey,
      pConfig.baseUrl,
    );
  } else if (pConfig.type === "openai") {
    providerInstance = new OpenAIProvider(pConfig.apiKey, pConfig.baseUrl);
  } else if (pConfig.type === "anthropic") {
    providerInstance = new AnthropicProvider(pConfig.apiKey, pConfig.baseUrl);
  } else if (pConfig.type === "ollama") {
    providerInstance = new OllamaProvider(pConfig.baseUrl);
  }

  if (!providerInstance) {
    console.error(
      picocolors.red(`Unsupported provider type "${pConfig.type}".`),
    );
    return;
  }

  const interaction: UserInteraction = {
    async askApproval(reason: string, preview?: string): Promise<boolean> {
      console.log(`\nRisk Warning: ${reason}`);
      if (preview) {
        console.log(picocolors.gray(`Parameters: ${preview}`));
      }
      return await Prompt.askApproval("Confirm action?");
    },
    showText(text: string): void {
      console.log(text);
    },
    async showDiff(
      filePath: string,
      before: string | null,
      after: string,
    ): Promise<void> {
      await pageText(DiffView.render(filePath, before, after));
    },
  };

  let activeTask = task;
  if (!activeTask) {
    await runRepl(
      cwd,
      config,
      providerInstance,
      interaction,
      multi,
      !!cliOverrides?.direct,
    );
    return;
  }

  if (multi) {
    const orchestrator = new Orchestrator(
      cwd,
      config,
      providerInstance,
      activeTask,
      interaction,
    );
    await orchestrator.run();
  } else {
    const loop = new AgentLoop(
      cwd,
      config,
      providerInstance,
      activeTask,
      interaction,
    );
    await loop.run();
  }
}

async function runRepl(
  cwd: string,
  config: any,
  providerInstance: any,
  interaction: UserInteraction,
  multi?: boolean,
  direct?: boolean,
): Promise<void> {
  const version = "v0.1.0";
  const sigintHandler = () => {
    // Prevent process exit on Ctrl+C during agent execution or REPL waiting.
  };
  process.on("SIGINT", sigintHandler);

  const isTTY =
    process.stdin.isTTY && typeof process.stdin.setRawMode === "function";
  const useFullscreenTui = isTTY && !direct;

  const tui = new FullscreenTui(cwd, config.models.default, version);
  tui.setPermissionsMode(config.permissions.mode);

  const tuiInteraction: UserInteraction = {
    async askApproval(reason: string, preview?: string): Promise<boolean> {
      const wasActive = useFullscreenTui && tui.isActive;
      if (wasActive) tui.stop();

      console.log(`\nRisk Warning: ${reason}`);
      if (preview) {
        console.log(picocolors.gray(`Parameters: ${preview}`));
      }
      const approved = await Prompt.askApproval("Confirm action?");

      if (wasActive) tui.start(config.budgetLimit);
      return approved;
    },
    showText(text: string): void {
      if (useFullscreenTui && tui.isActive) {
        tui.addLog(text);
      } else {
        console.log(text);
      }
    },
    async showDiff(
      filePath: string,
      before: string | null,
      after: string,
    ): Promise<void> {
      const wasActive = useFullscreenTui && tui.isActive;
      if (wasActive) tui.stop();

      await pageText(DiffView.render(filePath, before, after));

      if (wasActive) tui.start(config.budgetLimit);
    },
  };

  const localState = getLocalState(cwd);
  let resumeSessionId: string | undefined;
  if (localState.lastSessionId) {
    const resume = await Prompt.askApproval(
      `Found previous session (${localState.lastSessionId}). Resume last session?`,
    );
    if (resume) {
      resumeSessionId = localState.lastSessionId;
    }
  }

  const loop = new AgentLoop(
    cwd,
    config,
    providerInstance,
    "REPL Interactive Shell Started",
    tuiInteraction,
    {
      disableStatusBar: useFullscreenTui,
      sessionId: resumeSessionId,
    },
  );

  saveLocalState(cwd, {
    lastSessionId: loop.getSessionId(),
    lastModel: loop.getModelOverride() || config.models.default,
  });

  if (resumeSessionId && useFullscreenTui) {
    tui.loadHistory(loop.getHistory());
  }

  tui.setModelNameGetter(
    () => loop.getModelOverride() || config.models.default,
  );

  // Load autocomplete candidates
  let candidates = await getAutocompleteCandidates(cwd, config);
  tui.setCandidates(candidates);

  const onModelDelta = (payload: any) => {
    if (useFullscreenTui) {
      tui.handleModelDelta(payload.text);
    } else {
      process.stdout.write(payload.text);
    }
  };
  const onLoopStart = (payload: any) => {
    if (useFullscreenTui) {
      tui.startAttempt(payload.attempt);
    }
  };
  const onCostUpdate = (payload: any) => {
    if (useFullscreenTui) {
      tui.setCost(payload.sessionCost);
    }
  };
  const onThinkingDelta = (payload: any) => {
    if (useFullscreenTui) {
      tui.handleThinkingDelta(payload.text);
    } else {
      process.stdout.write(picocolors.gray(payload.text));
    }
  };

  eventBus.on("model_delta", onModelDelta);
  eventBus.on("loop_start", onLoopStart);
  eventBus.on("cost_update", onCostUpdate);
  eventBus.on("thinking_delta", onThinkingDelta);

  // Start background file watcher (Dynamic Incremental Watcher with Config Ignores)
  let watchTimeout: NodeJS.Timeout | null = null;
  const ignorePatterns = config.context?.ignore || [];
  const ignoreRegexes = ignorePatterns.map((pattern: string) => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    const finalPattern = escaped.endsWith(".*")
      ? "^" + escaped + "$"
      : "(^" + escaped + "$|^" + escaped + "\/.*)";
    return new RegExp(finalPattern);
  });

  const indexer = new SymbolIndexer(cwd);
  const watcher = watch(cwd, { recursive: true }, (eventType, filename) => {
    if (
      filename &&
      /\.(ts|tsx|js|jsx)$/.test(filename) &&
      !filename.includes(".orbit")
    ) {
      const normalized = filename.replace(/\\/g, "/");
      const isIgnored = ignoreRegexes.some((rx: RegExp) => rx.test(normalized));
      if (isIgnored) return;

      if (watchTimeout) clearTimeout(watchTimeout);
      watchTimeout = setTimeout(() => {
        indexer.index().catch(() => {});
      }, 500); // debounce 500ms
    }
  });

  if (useFullscreenTui) {
    tui.start(config.budgetLimit);
  } else {
    Renderer.printHeader(loop.getSessionId(), config.models.default, cwd);
  }

  try {
    while (true) {
      let input: string | null;
      if (useFullscreenTui) {
        input = await tui.askInput();
      } else {
        input = await Prompt.askTextWithAutocomplete(
          "Type your task or command...",
          makeCompleter(candidates),
          `${picocolors.bold(picocolors.magenta("orbit"))}${picocolors.gray(" ❯ ")}`,
        );
      }

      if (input === null) {
        if (useFullscreenTui) {
          tui.stop();
        }
        console.log(
          picocolors.yellow("Exiting Orbit Interactive Shell. Goodbye!"),
        );
        break;
      }
      if (!input) continue;

      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("/")) {
        tui.stop();
        const parts = trimmed.split(" ");
        const command = parts[0].toLowerCase();

        if (command === "/exit" || command === "/quit") {
          console.log(
            picocolors.yellow("Exiting Orbit Interactive Shell. Goodbye!"),
          );
          break;
        }

        if (command === "/help") {
          console.log("\nAvailable Slash Commands:");
          console.log("  /help           - Show this help message");
          console.log(
            "  /status         - Display session provider, active model, cost, and budget",
          );
          console.log(
            "  /config [k=v]   - View or modify configurations interactively or via key=value",
          );
          console.log(
            "  /model [name]   - Get or set the active model dynamically",
          );
          console.log(
            "  /chat           - Switch session or start a new session",
          );
          console.log(
            "  /api            - Configure API keys and Base URLs interactively",
          );
          console.log(
            "  /commit [msg]   - Stage changes and commit them (LLM message generation if empty)",
          );
          console.log("  /exit, /quit    - Terminate the REPL session");
          console.log(
            "  /rollback       - Revert the last file edits checkpoint",
          );
          console.log("  /clear          - Clear terminal screen");
          console.log("  /compact        - Compact older agent chat history");
          console.log(
            "  /history        - Display command history of this session",
          );
          console.log(
            "  /edit           - Open external editor for long/multiline prompts",
          );
          console.log(
            "  /inspect        - (CodeWhale) Visualize codebase outline and stats",
          );
          console.log(
            "  /doc [file]     - (Codex) Generate TSDoc/JSDoc documentation for a file",
          );
          console.log(
            "  /diagnose       - (AtomCode) Run tests and auto-repair failures",
          );
          console.log(
            "  /resolve [file] - Resolve merge conflicts in a file semantically using LLM",
          );
          console.log(
            "  /references [s] - Find all call sites and usages of symbol s in workspace\n",
          );
          continue;
        }

        if (command === "/api" || command === "/register") {
          const providersList = [
            { value: "deepseek-openai", label: "DeepSeek (OpenAI compatible)" },
            {
              value: "deepseek-anthropic",
              label: "DeepSeek (Anthropic compatible)",
            },
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" },
          ];
          const providerKey = await Prompt.askSelect(
            "Select API Provider to configure:",
            providersList,
          );
          if (!providerKey) {
            console.log(picocolors.yellow("API configuration cancelled."));
            continue;
          }

          const defaultBaseUrl =
            config.providers[providerKey]?.baseUrl ||
            (providerKey === "deepseek-openai"
              ? "https://api.deepseek.com"
              : providerKey === "deepseek-anthropic"
                ? "https://api.deepseek.com/anthropic"
                : providerKey === "openai"
                  ? "https://api.openai.com/v1"
                  : providerKey === "anthropic"
                    ? "https://api.anthropic.com"
                    : "");
          const baseUrl = await Prompt.askText(
            `Enter Base URL for ${providerKey}:`,
            defaultBaseUrl,
          );
          if (baseUrl === null) {
            console.log(picocolors.yellow("API configuration cancelled."));
            continue;
          }

          const apiKey = await Prompt.askPassword(
            `Enter API Key for ${providerKey}:`,
          );
          if (apiKey === null) {
            console.log(picocolors.yellow("API configuration cancelled."));
            continue;
          }

          const apiKeyEnv =
            providerKey === "deepseek-openai"
              ? "DEEPSEEK_API_KEY"
              : providerKey === "deepseek-anthropic"
                ? "ANTHROPIC_AUTH_TOKEN"
                : providerKey === "openai"
                  ? "OPENAI_API_KEY"
                  : providerKey === "anthropic"
                    ? "ANTHROPIC_API_KEY"
                    : `${providerKey.toUpperCase().replace(/-/g, "_")}_API_KEY`;

          // 1. Save API Key securely
          const credsManager = new CredentialsManager();
          credsManager.storeSecret(apiKeyEnv, apiKey);

          // 2. Save Base URL and apiKeyEnv to global config.yaml
          const {
            existsSync: fsExists,
            readFileSync: fsRead,
            writeFileSync: fsWrite,
            mkdirSync: fsMkdir,
          } = await import("fs");
          const { homedir: osHomedir } = await import("os");
          const { join: pathJoin, dirname: pathDirname } = await import("path");
          const { parse: yamlParse, stringify: yamlStringify } =
            await import("yaml");

          const globalConfigPath = pathJoin(
            osHomedir(),
            ".orbit",
            "config.yaml",
          );
          let globalConfig: any = {};
          if (fsExists(globalConfigPath)) {
            try {
              const raw = fsRead(globalConfigPath, "utf8");
              globalConfig = yamlParse(raw) || {};
            } catch {
              globalConfig = {};
            }
          }
          if (!globalConfig.providers) {
            globalConfig.providers = {};
          }
          globalConfig.providers[providerKey] = {
            ...globalConfig.providers[providerKey],
            baseUrl,
            apiKeyEnv,
          };
          try {
            const dir = pathDirname(globalConfigPath);
            if (!fsExists(dir)) {
              fsMkdir(dir, { recursive: true });
            }
            fsWrite(globalConfigPath, yamlStringify(globalConfig), "utf8");
            console.log(
              picocolors.green(
                `✔ Saved provider "${providerKey}" configuration to global config at ${globalConfigPath}`,
              ),
            );
          } catch (err: any) {
            console.log(
              picocolors.red(`Failed to save global config: ${err.message}`),
            );
          }

          // 3. Update active session configuration in memory
          const activeConfig = loop.getConfig();
          if (!activeConfig.providers[providerKey]) {
            activeConfig.providers[providerKey] = {
              type: providerKey.includes("anthropic")
                ? "anthropic-compatible"
                : "openai-compatible",
            };
          }
          activeConfig.providers[providerKey].baseUrl = baseUrl;
          activeConfig.providers[providerKey].apiKeyEnv = apiKeyEnv;
          activeConfig.providers[providerKey].apiKey = apiKey;

          // 4. Update the active providerInstance if configuring the current active provider
          const currentProviderKey = activeConfig.provider.default;
          if (providerKey === currentProviderKey && providerInstance) {
            (providerInstance as any).apiKey = apiKey;
            (providerInstance as any).baseUrl = baseUrl;
            console.log(
              picocolors.green(
                `✔ Instantly updated current provider "${providerKey}" session credentials.`,
              ),
            );
          }

          // 5. Ask if the user wants to switch the active provider to this provider
          if (providerKey !== currentProviderKey) {
            const switchNow = await Prompt.askApproval(
              `Would you like to switch the active provider to "${providerKey}" now?`,
            );
            if (switchNow) {
              activeConfig.provider.default = providerKey;

              // Re-create the providerInstance dynamically!
              let newProviderInstance: any;
              if (providerKey === "deepseek-anthropic") {
                newProviderInstance = new DeepSeekAnthropicProvider(
                  apiKey,
                  baseUrl,
                );
              } else if (providerKey === "deepseek-openai") {
                newProviderInstance = new DeepSeekOpenAIProvider(
                  apiKey,
                  baseUrl,
                );
              } else if (providerKey === "openai") {
                newProviderInstance = new OpenAIProvider(apiKey, baseUrl);
              } else if (providerKey === "anthropic") {
                newProviderInstance = new AnthropicProvider(apiKey, baseUrl);
              }

              if (newProviderInstance) {
                providerInstance = newProviderInstance;
                (loop as any).provider = newProviderInstance;
                console.log(
                  picocolors.green(
                    `✔ Switched session provider to "${providerKey}".`,
                  ),
                );
              } else {
                console.log(
                  picocolors.red(
                    `Failed to instantiate provider for "${providerKey}".`,
                  ),
                );
              }
            }
          }
          continue;
        }

        if (command === "/edit") {
          const tempFile = join(cwd, ".orbit", "orbit_prompt.md");
          try {
            const fs = await import("fs");
            const orbitDir = join(cwd, ".orbit");
            if (!fs.existsSync(orbitDir)) {
              fs.mkdirSync(orbitDir, { recursive: true });
            }
            fs.writeFileSync(
              tempFile,
              "# Describe your task or prompt here\n\n",
              "utf8",
            );
            console.log(
              picocolors.cyan(
                `Opening editor... Please save and close the file when finished.`,
              ),
            );
            const editor = config.editor || process.env.EDITOR || "notepad.exe";
            const { execSync } = await import("child_process");
            execSync(`${editor} "${tempFile}"`);
            const promptContent = fs
              .readFileSync(tempFile, "utf8")
              .replace(/#.*?\n/, "") // Strip header
              .trim();
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
            if (!promptContent) {
              console.log(picocolors.yellow("Empty prompt. Aborting."));
              continue;
            }
            console.log(
              picocolors.green(
                `Loaded prompt: "${promptContent.substring(0, 60)}..."`,
              ),
            );

            const state = (loop as any).state;
            state.task = promptContent;
            state.done = false;
            state.attemptCount = 0;

            state.history.push({
              id: `msg_user_${Date.now()}`,
              role: "user",
              createdAt: new Date().toISOString(),
              content: [{ type: "text", text: promptContent }],
            });

            if (multi) {
              const orchestrator = new Orchestrator(
                cwd,
                config,
                providerInstance,
                promptContent,
                tuiInteraction,
              );
              await orchestrator.run();
            } else {
              await loop.run();
            }
            tui.syncFromLoop(loop);
            tui.finishAttempt();
          } catch (err: any) {
            console.log(
              picocolors.red(`Failed to open editor: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/rollback") {
          await loop.rollbackLastCheckpoint();
          continue;
        }

        if (command === "/status") {
          const config = loop.getConfig();
          const provider = loop.getProvider();
          const activeModel = loop.getModelOverride() || config.models.default;
          const budgetLimit = config.budgetLimit;
          const currentCost = loop.getSessionCost();
          const mode = config.permissions.mode;

          console.log(
            picocolors.bold(
              picocolors.cyan(
                "\n┌── Orbit Session Status ──────────────────────────────────",
              ),
            ),
          );
          console.log(
            `${picocolors.gray("│")} 🆔 Session ID:   ${picocolors.green(loop.getSessionId())}`,
          );
          console.log(
            `${picocolors.gray("│")} 🔌 Provider:     ${picocolors.green(provider.id)} (${provider.baseUrl || "Default URL"})`,
          );
          console.log(
            `${picocolors.gray("│")} 🤖 Active Model:  ${picocolors.green(activeModel)}`,
          );
          console.log(
            `${picocolors.gray("│")} 💰 Session Cost: $${currentCost.toFixed(4)} / $${budgetLimit.toFixed(2)} (Limit)`,
          );
          console.log(
            `${picocolors.gray("│")} 🛡️ Security Mode: ${picocolors.green(mode.toUpperCase())}`,
          );
          console.log(
            picocolors.cyan(
              "└───────────────────────────────────────────────────────────\n",
            ),
          );
          continue;
        }

        if (command === "/config") {
          const configArg = parts.slice(1).join(" ").trim();
          const activeConfig = loop.getConfig();

          if (configArg) {
            const eqIndex = configArg.indexOf("=");
            if (eqIndex === -1) {
              console.log(
                picocolors.yellow(
                  "Usage: /config <key>=<value> or just /config for interactive menu.",
                ),
              );
              continue;
            }
            const key = configArg.slice(0, eqIndex).trim();
            const rawVal = configArg.slice(eqIndex + 1).trim();

            const currentVal = getNestedProperty(activeConfig, key);
            if (currentVal === undefined) {
              console.log(
                picocolors.red(`Error: Unknown configuration key "${key}".`),
              );
              continue;
            }

            let parsedVal: any = rawVal;
            if (typeof currentVal === "boolean") {
              const lowerVal = rawVal.toLowerCase();
              if (lowerVal === "true" || lowerVal === "1") parsedVal = true;
              else if (lowerVal === "false" || lowerVal === "0")
                parsedVal = false;
              else {
                console.log(
                  picocolors.red(
                    `Error: Key "${key}" expects a boolean value (true/false).`,
                  ),
                );
                continue;
              }
            } else if (typeof currentVal === "number") {
              const num = Number(rawVal);
              if (isNaN(num)) {
                console.log(
                  picocolors.red(
                    `Error: Key "${key}" expects a numeric value.`,
                  ),
                );
                continue;
              }
              parsedVal = num;
            } else if (Array.isArray(currentVal)) {
              parsedVal = rawVal
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            }

            const testConfig = JSON.parse(JSON.stringify(activeConfig));
            setNestedProperty(testConfig, key, parsedVal);

            const parseResult = ConfigSchema.safeParse(testConfig);
            if (!parseResult.success) {
              console.log(
                picocolors.red(
                  `Configuration validation failed: ${parseResult.error.message}`,
                ),
              );
              continue;
            }

            setNestedProperty(activeConfig, key, parsedVal);
            console.log(
              picocolors.green(`✔ Updated "${key}" to: ${parsedVal}`),
            );
            continue;
          }

          while (true) {
            const currentMode = activeConfig.permissions.mode;
            const currentBudget = activeConfig.budgetLimit;
            const currentAllowRead = activeConfig.permissions.allowRead;
            const currentApprovalWrite =
              activeConfig.permissions.requireApprovalForWrite;
            const currentApprovalBash =
              activeConfig.permissions.requireApprovalForBash;
            const currentBlockDangerous =
              activeConfig.permissions.blockDangerousCommands;
            const currentProtectSecrets =
              activeConfig.permissions.protectSecrets;
            const currentBashEnabled = activeConfig.tools.bash.enabled;
            const currentSearchEnabled = activeConfig.tools.webSearch.enabled;
            const currentMcpEnabled = activeConfig.tools.mcp.enabled;
            const currentEditor = activeConfig.editor;
            const currentAutoCommit = activeConfig.autoCommit;
            const currentProtectedPaths =
              activeConfig.permissions.protectedPaths;
            const currentIgnore = activeConfig.context.ignore;

            const choice = await Prompt.askSelect(
              "Select a configuration key to modify:",
              [
                {
                  value: "permissions.mode",
                  label: `🛡️  permissions.mode (current: ${currentMode})`,
                },
                {
                  value: "budgetLimit",
                  label: `💰 budgetLimit (current: $${currentBudget})`,
                },
                {
                  value: "permissions.allowRead",
                  label: `📄 permissions.allowRead (current: ${currentAllowRead})`,
                },
                {
                  value: "permissions.requireApprovalForWrite",
                  label: `✏️  permissions.requireApprovalForWrite (current: ${currentApprovalWrite})`,
                },
                {
                  value: "permissions.requireApprovalForBash",
                  label: `🐚 permissions.requireApprovalForBash (current: ${currentApprovalBash})`,
                },
                {
                  value: "permissions.blockDangerousCommands",
                  label: `🚫 permissions.blockDangerousCommands (current: ${currentBlockDangerous})`,
                },
                {
                  value: "permissions.protectSecrets",
                  label: `🔑 permissions.protectSecrets (current: ${currentProtectSecrets})`,
                },
                {
                  value: "tools.bash.enabled",
                  label: `💻 tools.bash.enabled (current: ${currentBashEnabled})`,
                },
                {
                  value: "tools.webSearch.enabled",
                  label: `🌐 tools.webSearch.enabled (current: ${currentSearchEnabled})`,
                },
                {
                  value: "tools.mcp.enabled",
                  label: `🔌 tools.mcp.enabled (current: ${currentMcpEnabled})`,
                },
                {
                  value: "permissions.protectedPaths",
                  label: `🔒 permissions.protectedPaths (current: ${currentProtectedPaths.join(", ")})`,
                },
                {
                  value: "context.ignore",
                  label: `🗂️  context.ignore (current: ${currentIgnore.join(", ")})`,
                },
                {
                  value: "editor",
                  label: `📝 editor (current: ${currentEditor})`,
                },
                {
                  value: "autoCommit",
                  label: `🚀 autoCommit (current: ${currentAutoCommit})`,
                },
                { value: "exit", label: "❌ Exit Menu" },
              ],
            );

            if (choice === null || choice === "exit" || choice === "") {
              break;
            }

            const currentVal = getNestedProperty(activeConfig, choice);
            if (typeof currentVal === "boolean") {
              const nextVal = await Prompt.askSelect(`Set ${choice} to:`, [
                { value: "true", label: "true" },
                { value: "false", label: "false" },
              ]);
              if (nextVal !== null && nextVal !== "") {
                const boolVal = nextVal === "true";
                const testConfig = JSON.parse(JSON.stringify(activeConfig));
                setNestedProperty(testConfig, choice, boolVal);
                const parseResult = ConfigSchema.safeParse(testConfig);
                if (parseResult.success) {
                  setNestedProperty(activeConfig, choice, boolVal);
                  console.log(
                    picocolors.green(`✔ Updated "${choice}" to: ${boolVal}`),
                  );
                } else {
                  console.log(
                    picocolors.red(
                      `Validation error: ${parseResult.error.message}`,
                    ),
                  );
                }
              }
            } else if (choice === "permissions.mode") {
              const nextVal = await Prompt.askSelect(
                "Set permissions.mode to:",
                [
                  {
                    value: "strict",
                    label:
                      "strict (High security, ask for write/exec, block dangerous)",
                  },
                  {
                    value: "normal",
                    label: "normal (Standard safety, ask for all write/exec)",
                  },
                  {
                    value: "auto",
                    label:
                      "auto (Allow write/exec automatically, block dangerous)",
                  },
                  {
                    value: "plan",
                    label: "plan (Interactive planning mode - read-only)",
                  },
                ],
              );
              if (nextVal !== null && nextVal !== "") {
                const testConfig = JSON.parse(JSON.stringify(activeConfig));
                setNestedProperty(testConfig, choice, nextVal);
                const parseResult = ConfigSchema.safeParse(testConfig);
                if (parseResult.success) {
                  setNestedProperty(activeConfig, choice, nextVal);
                  console.log(
                    picocolors.green(`✔ Updated "${choice}" to: ${nextVal}`),
                  );
                } else {
                  console.log(
                    picocolors.red(
                      `Validation error: ${parseResult.error.message}`,
                    ),
                  );
                }
              }
            } else if (choice === "budgetLimit") {
              const nextValStr = await Prompt.askText(
                `Enter new budget limit (number):`,
                String(currentVal),
              );
              if (nextValStr !== null && nextValStr !== "") {
                const numVal = Number(nextValStr);
                if (isNaN(numVal)) {
                  console.log(
                    picocolors.red(
                      "Error: budgetLimit must be a valid number.",
                    ),
                  );
                } else {
                  const testConfig = JSON.parse(JSON.stringify(activeConfig));
                  setNestedProperty(testConfig, choice, numVal);
                  const parseResult = ConfigSchema.safeParse(testConfig);
                  if (parseResult.success) {
                    setNestedProperty(activeConfig, choice, numVal);
                    console.log(
                      picocolors.green(`✔ Updated "${choice}" to: ${numVal}`),
                    );
                  } else {
                    console.log(
                      picocolors.red(
                        `Validation error: ${parseResult.error.message}`,
                      ),
                    );
                  }
                }
              }
            } else if (Array.isArray(currentVal)) {
              const nextValStr = await Prompt.askText(
                `Enter comma-separated values for ${choice}:`,
                currentVal.join(", "),
              );
              if (nextValStr !== null && nextValStr !== "") {
                const arrVal = nextValStr
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                const testConfig = JSON.parse(JSON.stringify(activeConfig));
                setNestedProperty(testConfig, choice, arrVal);
                const parseResult = ConfigSchema.safeParse(testConfig);
                if (parseResult.success) {
                  setNestedProperty(activeConfig, choice, arrVal);
                  console.log(
                    picocolors.green(
                      `✔ Updated "${choice}" to: [${arrVal.join(", ")}]`,
                    ),
                  );
                } else {
                  console.log(
                    picocolors.red(
                      `Validation error: ${parseResult.error.message}`,
                    ),
                  );
                }
              }
            } else if (
              typeof currentVal === "string" &&
              choice !== "permissions.mode"
            ) {
              const nextValStr = await Prompt.askText(
                `Enter value for ${choice}:`,
                String(currentVal),
              );
              if (nextValStr !== null && nextValStr !== "") {
                const testConfig = JSON.parse(JSON.stringify(activeConfig));
                setNestedProperty(testConfig, choice, nextValStr);
                const parseResult = ConfigSchema.safeParse(testConfig);
                if (parseResult.success) {
                  setNestedProperty(activeConfig, choice, nextValStr);
                  console.log(
                    picocolors.green(`✔ Updated "${choice}" to: ${nextValStr}`),
                  );
                } else {
                  console.log(
                    picocolors.red(
                      `Validation error: ${parseResult.error.message}`,
                    ),
                  );
                }
              }
            }
          }
          continue;
        }

        if (command === "/model") {
          const modelArg = parts.slice(1).join(" ").trim();
          const config = loop.getConfig();
          if (!modelArg) {
            const activeModel =
              loop.getModelOverride() || config.models.default;
            const selectedModel = await Prompt.askSelect(
              `Current model: ${activeModel}. Select a model to switch:`,
              [
                {
                  value: "deepseek-v4-flash",
                  label: "deepseek-v4-flash (DeepSeek-V4 / Fast & Flash)",
                },
                {
                  value: "deepseek-v4-pro",
                  label: "deepseek-v4-pro (DeepSeek-V4 / Advanced & Pro)",
                },
                {
                  value: "deepseek-chat",
                  label: "deepseek-chat (DeepSeek-V3 / Chat - Deprecated soon)",
                },
                {
                  value: "deepseek-reasoner",
                  label:
                    "deepseek-reasoner (DeepSeek-R1 / Reasoner - Deprecated soon)",
                },
                { value: "custom", label: "Custom model name..." },
                { value: "cancel", label: "Cancel" },
              ],
            );
            if (!selectedModel || selectedModel === "cancel") {
              continue;
            }
            let finalModel = selectedModel;
            if (selectedModel === "custom") {
              const customModel = await Prompt.askText(
                "Enter custom model name:",
              );
              if (customModel) {
                finalModel = customModel;
                loop.setModelOverride(customModel);
                console.log(
                  `Switched active model to: ${picocolors.green(customModel)}`,
                );
              } else {
                continue;
              }
            } else {
              loop.setModelOverride(selectedModel);
              console.log(
                `Switched active model to: ${picocolors.green(selectedModel)}`,
              );
            }
            saveLocalState(cwd, { lastModel: finalModel });
            continue;
          }

          loop.setModelOverride(modelArg);
          console.log(
            `Switched active model to: ${picocolors.green(modelArg)}`,
          );
          saveLocalState(cwd, { lastModel: modelArg });
          continue;
        }

        if (command === "/commit") {
          const commitMsg = parts.slice(1).join(" ").trim();
          const config = loop.getConfig();
          const { execSync } = await import("child_process");
          try {
            const diff = execSync("git diff --cached", { cwd })
              .toString()
              .trim();
            if (!diff) {
              console.log(
                picocolors.yellow(
                  'No staged changes found to commit. Run "git add" first.',
                ),
              );
              continue;
            }

            let finalMsg = commitMsg;
            if (!finalMsg) {
              console.log("Generating commit message via LLM...");
              const fastModel = config.models.fast || config.models.default;
              const stream = providerInstance.chat({
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

            console.log(
              `Committing changes with message: "${picocolors.green(finalMsg)}"`,
            );
            const commitCmd = `git commit -m ${JSON.stringify(finalMsg)}`;
            execSync(commitCmd, { cwd });
            console.log(picocolors.green("✔ Git commit created successfully."));
          } catch (err: any) {
            console.log(picocolors.red(`✖ Commit failed: ${err.message}`));
          }
          continue;
        }

        if (command === "/clear") {
          console.clear();
          continue;
        }

        if (command === "/compact") {
          console.log("Compacting history...");
          const history = loop.getHistory();
          if (history.length > 12) {
            const systemMsg = history[0];
            const discarded = history.slice(1, history.length - 10);
            const recentMsgs = history.slice(history.length - 10);

            let rawText = "";
            for (const msg of discarded) {
              rawText +=
                `[${msg.role.toUpperCase()}]: ` +
                msg.content
                  .map((c) => {
                    if (c.type === "text") return c.text;
                    if (c.type === "tool_call")
                      return `[Tool Call: ${c.toolCall?.name}]`;
                    if (c.type === "tool_result")
                      return `[Tool Result: ${c.toolResult?.name}]`;
                    return "";
                  })
                  .join(" ") +
                "\n";
            }

            console.log("Generating session summary via LLM...");
            let summaryText = "Prior dialogue history compacted.";
            try {
              const fastModel = config.models.fast || config.models.default;
              const stream = providerInstance.chat({
                model: fastModel,
                messages: [
                  {
                    id: `msg_compact_${Date.now()}`,
                    role: "user",
                    createdAt: new Date().toISOString(),
                    content: [
                      {
                        type: "text",
                        text: `Summarize the following dialog history of an AI coding session in a brief, concise paragraph (max 150 words). Focus on what files were modified, what tasks were accomplished, and any critical developer rules established. Do not include introductory text, just the summary:\n\n${rawText.substring(0, 15000)}`,
                      },
                    ],
                  },
                ],
                tools: [],
              });

              let responseContent = "";
              for await (const event of stream) {
                if (event.type === "text_delta") {
                  responseContent += event.text;
                }
              }
              if (responseContent.trim()) {
                summaryText = responseContent.trim();
              }
            } catch (err: any) {
              console.log(
                picocolors.yellow(
                  `⚠ LLM compaction query failed: ${err.message}. Using default compaction.`,
                ),
              );
            }

            const summaryMsg = {
              id: `msg_summary_${Date.now()}`,
              role: "system",
              createdAt: new Date().toISOString(),
              content: [
                {
                  type: "text",
                  text: `Prior session history summary:\n${summaryText}`,
                },
              ],
            };

            history.length = 0;
            if (systemMsg) {
              history.push(systemMsg);
            }
            history.push(summaryMsg);
            history.push(...recentMsgs);
            (loop as any).sessionManager.saveHistory(history);

            console.log(
              picocolors.green(
                `✔ History compacted! Retained first system message, generated history summary, and last 10 messages. Total: ${history.length}`,
              ),
            );
          } else {
            console.log(picocolors.yellow("History is too short to compact."));
          }
          continue;
        }

        if (command === "/history") {
          const history = loop.getHistory();
          let fullHistoryText = picocolors.bold(
            picocolors.cyan(
              "\n┌── Orbit Session Complete Dialogue History ────────────────\n",
            ),
          );

          for (const msg of history) {
            if (msg.role === "user") {
              const text = msg.content
                .map((c) => (c.type === "text" ? c.text : ""))
                .join("");
              fullHistoryText += `${picocolors.cyan("orbit >")} ${picocolors.bold(picocolors.white(text))}\n\n`;
            } else if (msg.role === "assistant") {
              const text = msg.content
                .map((c) => {
                  if (c.type === "text") return c.text;
                  if (c.type === "tool_call")
                    return `[Tool Call: ${c.toolCall?.name} arguments: ${c.toolCall?.arguments}]`;
                  return "";
                })
                .join("\n");
              if (text.trim()) {
                fullHistoryText += Renderer.formatMarkdown(text) + "\n\n";
              }
            } else if (msg.role === "tool") {
              const text = msg.content
                .map((c) =>
                  c.type === "tool_result"
                    ? `[Tool Result: ${c.toolResult?.name} status: ${c.toolResult?.status || "success"}]`
                    : "",
                )
                .join("\n");
              if (text.trim()) {
                fullHistoryText += picocolors.dim(text) + "\n\n";
              }
            }
          }
          fullHistoryText += picocolors.cyan(
            "└───────────────────────────────────────────────────────────\n",
          );

          await pageText(fullHistoryText);
          continue;
        }

        if (command === "/inspect") {
          const indexPath = join(cwd, ".orbit", "symbols.json");
          if (!existsSync(indexPath)) {
            console.log(
              picocolors.yellow(
                "No symbols index found. Please run a task first to generate the symbol map.",
              ),
            );
            continue;
          }

          try {
            const raw = readFileSync(indexPath, "utf8");
            const index = JSON.parse(raw);
            if (index.files && typeof index.files === "object") {
              console.log(
                picocolors.bold(
                  picocolors.cyan(
                    "\n┌── CodeWhale Codebase Visual Outline ──────────────────────",
                  ),
                ),
              );

              let totalFiles = 0;
              let totalSymbols = 0;
              let tsFiles = 0;

              for (const [file, fileData] of Object.entries(index.files)) {
                totalFiles++;
                if (file.endsWith(".ts") || file.endsWith(".tsx")) {
                  tsFiles++;
                }
                const data = fileData as any;
                if (data && Array.isArray(data.symbols)) {
                  console.log(
                    `${picocolors.gray("│")} 📄 ${picocolors.bold(picocolors.blue(file))}`,
                  );
                  for (const sym of data.symbols) {
                    totalSymbols++;
                    const symbolColor =
                      sym.type === "class"
                        ? picocolors.magenta
                        : picocolors.green;
                    console.log(
                      `${picocolors.gray("│")}    ├── ${symbolColor(sym.name)} (${picocolors.gray(sym.type)})`,
                    );
                  }
                }
              }

              const tsRatio =
                totalFiles > 0
                  ? ((tsFiles / totalFiles) * 100).toFixed(1)
                  : "0.0";
              console.log(
                picocolors.gray(
                  "├───────────────────────────────────────────────────────────",
                ),
              );
              console.log(
                `${picocolors.gray("│")} ${picocolors.bold("Codebase Stats:")}`,
              );
              console.log(
                `${picocolors.gray("│")}   • Total Indexed Files: ${picocolors.green(totalFiles)}`,
              );
              console.log(
                `${picocolors.gray("│")}   • TypeScript Ratio   : ${picocolors.yellow(tsRatio + "%")}`,
              );
              console.log(
                `${picocolors.gray("│")}   • Exported Symbols   : ${picocolors.magenta(totalSymbols)}`,
              );
              console.log(
                picocolors.cyan(
                  "└───────────────────────────────────────────────────────────\n",
                ),
              );
            }
          } catch (err: any) {
            console.log(
              picocolors.red(`Failed to parse symbol index: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/doc") {
          const fileArg = parts.slice(1).join(" ").trim();
          if (!fileArg) {
            console.log(picocolors.yellow("Usage: /doc <file_path>"));
            continue;
          }

          let targetFilePath: string;
          try {
            targetFilePath = resolveSafePath(cwd, fileArg);
          } catch (err: any) {
            console.log(picocolors.red(`Error: ${err.message}`));
            continue;
          }
          if (!existsSync(targetFilePath)) {
            console.log(picocolors.red(`Error: File not found: ${fileArg}`));
            continue;
          }

          console.log(
            picocolors.cyan(
              `Generating documentation for ${fileArg} via LLM...`,
            ),
          );
          try {
            const content = readFileSync(targetFilePath, "utf8");
            const fastModel = config.models.fast || config.models.default;

            const stream = providerInstance.chat({
              model: fastModel,
              messages: [
                {
                  id: `msg_doc_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [
                    {
                      type: "text",
                      text: `Analyze the following code file and add clean, professional TSDoc/JSDoc comments for all exported functions, classes, interfaces, and methods. Preserve all existing logic, code, and comments exactly. Return ONLY the complete modified code file, with no markdown, no quotes, and no explanations:\n\n${content}`,
                    },
                  ],
                },
              ],
              tools: [],
            });

            let documentedCode = "";
            for await (const event of stream) {
              if (event.type === "text_delta") {
                documentedCode += event.text;
              }
            }

            documentedCode = documentedCode
              .trim()
              .replace(/^```[a-zA-Z]*\n/, "")
              .replace(/\n```$/, "");
            if (!documentedCode) {
              console.log(
                picocolors.red("Failed to generate documented code."),
              );
              continue;
            }

            const state = (loop as any).state;
            state.task = `Add TSDoc/JSDoc comments to ${fileArg}`;
            state.done = false;
            state.attemptCount = 0;

            const writeToolCall = {
              id: `tc_doc_${Date.now()}`,
              name: "write_file",
              arguments: JSON.stringify({
                path: targetFilePath,
                content: documentedCode,
              }),
            };

            state.history.push({
              id: `msg_user_${Date.now()}`,
              role: "user",
              createdAt: new Date().toISOString(),
              content: [
                { type: "text", text: `Write JSDoc comments to ${fileArg}` },
              ],
            });

            const assistantMsg = {
              id: `msg_asst_doc_${Date.now()}`,
              role: "assistant",
              createdAt: new Date().toISOString(),
              content: [{ type: "tool_call", toolCall: writeToolCall }],
            };
            state.history.push(assistantMsg);

            await loop.run();
          } catch (err: any) {
            console.log(
              picocolors.red(
                `Failed to generate documentation: ${err.message}`,
              ),
            );
          }
          continue;
        }

        if (command === "/diagnose") {
          const testCommand =
            (config.context?.testCommands && config.context.testCommands[0]) ||
            "npm test";
          console.log(
            picocolors.cyan(`Running test suite: "${testCommand}"...`),
          );

          const { exec } = await import("child_process");
          const runTestPromise = () =>
            new Promise<{ stdout: string; stderr: string; code: number }>(
              (resolve) => {
                exec(testCommand, { cwd }, (err, stdout, stderr) => {
                  resolve({
                    stdout,
                    stderr,
                    code: err ? err.code || 1 : 0,
                  });
                });
              },
            );

          const testResult = await runTestPromise();
          if (testResult.code === 0) {
            console.log(
              picocolors.green(
                `✔ All tests passed successfully! No diagnostics needed.`,
              ),
            );
            continue;
          }

          console.log(
            picocolors.red(`✖ Tests failed! Outputting diagnostics...`),
          );
          console.log(picocolors.gray(testResult.stdout || testResult.stderr));

          const repairPrompt = `The test command "${testCommand}" failed. The output log is:\n\n${testResult.stdout || testResult.stderr}\n\nPlease analyze the failure logs, locate the files causing assertion or syntax errors, and fix the codebase so that the test suite passes successfully.`;

          const confirmRepair = await Prompt.askApproval(
            "Launch Agent Loop to auto-repair the test failures?",
          );
          if (!confirmRepair) {
            console.log(picocolors.yellow("Diagnostics aborted."));
            continue;
          }

          const state = (loop as any).state;
          state.task = `Auto-repair test failures for "${testCommand}"`;
          state.done = false;
          state.attemptCount = 0;

          state.history.push({
            id: `msg_user_${Date.now()}`,
            role: "user",
            createdAt: new Date().toISOString(),
            content: [{ type: "text", text: repairPrompt }],
          });

          if (multi) {
            const orchestrator = new Orchestrator(
              cwd,
              config,
              providerInstance,
              repairPrompt,
              tuiInteraction,
            );
            await orchestrator.run();
          } else {
            await loop.run();
          }
          tui.syncFromLoop(loop);
          tui.finishAttempt();
          continue;
        }

        if (command === "/chat") {
          const sessions = loop.getSessions();
          if (sessions.length === 0) {
            console.log(
              picocolors.yellow("No active or saved sessions found."),
            );
            continue;
          }

          const sessionOptions = sessions.map((s: any) => {
            const formattedDate = new Date(s.createdAt).toLocaleString();
            return {
              value: s.id,
              label: `${s.id} - ${s.title || "Untitled"} (${formattedDate}) [${s.model}]`,
            };
          });

          sessionOptions.unshift({
            value: "new",
            label: picocolors.green("+ Start a new session"),
          });
          sessionOptions.push({
            value: "cancel",
            label: "Cancel",
          });

          const selectedSessionId = await Prompt.askSelect(
            "Choose a session to load:",
            sessionOptions,
          );

          if (!selectedSessionId || selectedSessionId === "cancel") {
            continue;
          }

          if (selectedSessionId === "new") {
            const activeModel =
              loop.getModelOverride() || config.models.default;
            const newSessionId = loop.startNewSession(
              providerInstance.id,
              activeModel,
            );
            tui.loadHistory([]);
            console.log(
              picocolors.green(`✔ Started new session: ${newSessionId}`),
            );

            saveLocalState(cwd, {
              lastSessionId: newSessionId,
              lastModel: activeModel,
            });
          } else {
            const success = loop.resumeSession(selectedSessionId);
            if (success) {
              tui.loadHistory(loop.getHistory());
              console.log(
                picocolors.green(`✔ Switched to session: ${selectedSessionId}`),
              );

              saveLocalState(cwd, {
                lastSessionId: selectedSessionId,
                lastModel: loop.getModelOverride() || config.models.default,
              });
            } else {
              console.log(
                picocolors.red(
                  `Failed to resume session: ${selectedSessionId}`,
                ),
              );
            }
          }
          continue;
        }

        if (command === "/resolve") {
          const fileArg = parts.slice(1).join(" ").trim();
          if (!fileArg) {
            console.log(picocolors.yellow("Usage: /resolve <file_path>"));
            continue;
          }

          let targetFilePath: string;
          try {
            targetFilePath = resolveSafePath(cwd, fileArg);
          } catch (err: any) {
            console.log(picocolors.red(`Error: ${err.message}`));
            continue;
          }
          if (!existsSync(targetFilePath)) {
            console.log(picocolors.red(`Error: File not found: ${fileArg}`));
            continue;
          }

          try {
            const content = readFileSync(targetFilePath, "utf8");
            if (
              !content.includes("<<<<<<<") ||
              !content.includes("=======") ||
              !content.includes(">>>>>>>")
            ) {
              console.log(
                picocolors.yellow(
                  "No git merge conflict markers found in this file.",
                ),
              );
              continue;
            }

            console.log(
              picocolors.cyan(`Resolving conflicts in ${fileArg} via LLM...`),
            );
            const fastModel = config.models.fast || config.models.default;

            const stream = providerInstance.chat({
              model: fastModel,
              messages: [
                {
                  id: `msg_resolve_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [
                    {
                      type: "text",
                      text: `Resolve the git merge conflict markers in this file. Merge the changes logically. Preserve all other code structure and logic exactly. Return ONLY the complete resolved code file, with no markdown, no quotes, and no explanations:\n\n${content}`,
                    },
                  ],
                },
              ],
              tools: [],
            });

            let resolvedCode = "";
            for await (const event of stream) {
              if (event.type === "text_delta") {
                resolvedCode += event.text;
              }
            }

            resolvedCode = resolvedCode
              .trim()
              .replace(/^```[a-zA-Z]*\n/, "")
              .replace(/\n```$/, "");
            if (!resolvedCode) {
              console.log(picocolors.red("Failed to generate resolved code."));
              continue;
            }

            const state = (loop as any).state;
            state.task = `Resolve git merge conflicts in ${fileArg}`;
            state.done = false;
            state.attemptCount = 0;

            const writeToolCall = {
              id: `tc_resolve_${Date.now()}`,
              name: "write_file",
              arguments: JSON.stringify({
                path: targetFilePath,
                content: resolvedCode,
              }),
            };

            state.history.push({
              id: `msg_user_${Date.now()}`,
              role: "user",
              createdAt: new Date().toISOString(),
              content: [
                {
                  type: "text",
                  text: `Resolve git merge conflicts in ${fileArg}`,
                },
              ],
            });

            const assistantMsg = {
              id: `msg_asst_resolve_${Date.now()}`,
              role: "assistant",
              createdAt: new Date().toISOString(),
              content: [{ type: "tool_call", toolCall: writeToolCall }],
            };
            state.history.push(assistantMsg);

            await loop.run();
            tui.syncFromLoop(loop);
            tui.finishAttempt();
          } catch (err: any) {
            console.log(
              picocolors.red(`Failed to resolve conflicts: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/references") {
          const symbolArg = parts.slice(1).join(" ").trim();
          if (!symbolArg) {
            console.log(picocolors.yellow("Usage: /references <symbol_name>"));
            continue;
          }

          const indexPath = join(cwd, ".orbit", "symbols.json");
          if (!existsSync(indexPath)) {
            console.log(
              picocolors.yellow(
                "No symbols index found. Please run a task first to generate the symbol map.",
              ),
            );
            continue;
          }

          try {
            const raw = readFileSync(indexPath, "utf8");
            const index = JSON.parse(raw);
            let exportedFile: string | null = null;
            if (index.files && typeof index.files === "object") {
              for (const [file, fileData] of Object.entries(index.files)) {
                const data = fileData as any;
                if (data && Array.isArray(data.symbols)) {
                  if (data.symbols.some((s: any) => s.name === symbolArg)) {
                    exportedFile = file;
                    break;
                  }
                }
              }

              console.log(
                picocolors.bold(
                  picocolors.cyan(
                    `\n┌── Symbol References Finder: ${symbolArg} ──────────────`,
                  ),
                ),
              );
              if (exportedFile) {
                console.log(
                  `${picocolors.gray("│")} 🔑 Exported by: ${picocolors.green(exportedFile)}`,
                );
              } else {
                console.log(
                  `${picocolors.gray("│")} 🔑 Exported by: ${picocolors.gray("Unknown (Internal / Not exported)")}`,
                );
              }
              console.log(
                picocolors.gray(
                  "├───────────────────────────────────────────────────────────",
                ),
              );

              let refCount = 0;
              const symbolRegex = new RegExp(`\\b${symbolArg}\\b`);
              for (const [file, fileData] of Object.entries(index.files)) {
                const absPath = join(cwd, file);
                if (existsSync(absPath)) {
                  const lines = readFileSync(absPath, "utf8").split("\n");
                  for (let idx = 0; idx < lines.length; idx++) {
                    const line = lines[idx];
                    const trimmed = line.trim();

                    if (
                      trimmed.startsWith("//") ||
                      trimmed.startsWith("*") ||
                      trimmed.startsWith("/*")
                    ) {
                      continue;
                    }

                    if (
                      symbolRegex.test(line) &&
                      !line.includes("export ") &&
                      !line.includes("symbols.some")
                    ) {
                      refCount++;
                      console.log(
                        `${picocolors.gray("│")} 📁 ${picocolors.blue(file)}:${picocolors.yellow(idx + 1)}`,
                      );
                      console.log(
                        `${picocolors.gray("│")}    ${picocolors.gray(line.trim().substring(0, 80))}`,
                      );
                    }
                  }
                }
              }

              console.log(
                picocolors.gray(
                  "├───────────────────────────────────────────────────────────",
                ),
              );
              console.log(
                `${picocolors.gray("│")} Total Usages Found: ${picocolors.green(refCount)}`,
              );
              console.log(
                picocolors.cyan(
                  "└───────────────────────────────────────────────────────────\n",
                ),
              );
            }
          } catch (err: any) {
            console.log(
              picocolors.red(`Failed to search references: ${err.message}`),
            );
          }
          continue;
        }

        console.log(
          picocolors.red(
            `Unknown command: ${command}. Type /help for available commands.`,
          ),
        );
        continue;
      }

      const state = (loop as any).state;
      state.task = trimmed;
      state.done = false;
      state.attemptCount = 0;

      state.history.push({
        id: `msg_user_${Date.now()}`,
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: trimmed }],
      });

      if (multi) {
        const orchestrator = new Orchestrator(
          cwd,
          config,
          providerInstance,
          trimmed,
          tuiInteraction,
        );
        await orchestrator.run();
      } else {
        await loop.run();
      }
      tui.syncFromLoop(loop);
      tui.finishAttempt();

      // Refresh candidates in the background asynchronously
      getAutocompleteCandidates(cwd, config)
        .then((c) => {
          candidates = c;
        })
        .catch(() => {});
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    watcher.close();
    if (watchTimeout) clearTimeout(watchTimeout);
    eventBus.off("model_delta", onModelDelta);
    eventBus.off("loop_start", onLoopStart);
    eventBus.off("cost_update", onCostUpdate);
    eventBus.off("thinking_delta", onThinkingDelta);
    tui.stop();
  }
}

async function getAutocompleteCandidates(
  cwd: string,
  config: any,
): Promise<{
  commands: string[];
  files: string[];
  symbols: string[];
}> {
  const commands = [
    "/help",
    "/status",
    "/config",
    "/model",
    "/chat",
    "/commit",
    "/exit",
    "/quit",
    "/rollback",
    "/clear",
    "/compact",
    "/history",
    "/edit",
    "/inspect",
    "/doc",
    "/diagnose",
    "/resolve",
    "/references",
    "/api",
    "/register",
  ];
  const files: string[] = [];
  const symbols: string[] = [];

  try {
    const ignorePatterns = config.context?.ignore || [];
    const globbedFiles = await glob("**/*", {
      cwd,
      ignore: ignorePatterns,
      onlyFiles: true,
      dot: true,
    });
    files.push(...globbedFiles);
  } catch {
    // Ignored
  }

  try {
    const indexPath = join(cwd, ".orbit", "symbols.json");
    if (existsSync(indexPath)) {
      const raw = readFileSync(indexPath, "utf8");
      const index = JSON.parse(raw);
      if (index.files && typeof index.files === "object") {
        for (const fileData of Object.values(index.files)) {
          const data = fileData as any;
          if (data && Array.isArray(data.symbols)) {
            for (const sym of data.symbols) {
              if (sym.name) {
                symbols.push(sym.name);
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignored
  }

  return {
    commands,
    files,
    symbols: Array.from(new Set(symbols)),
  };
}

function makeCompleter(candidates: {
  commands: string[];
  files: string[];
  symbols: string[];
}) {
  return (line: string): [string[], string] => {
    if (line.startsWith("/")) {
      const hits = candidates.commands.filter((c) => c.startsWith(line));
      return [hits.length ? hits : candidates.commands, line];
    }

    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1] || "";

    if (!lastWord) {
      return [[], lastWord];
    }

    const fileHits = candidates.files.filter((f) => f.startsWith(lastWord));
    const symbolHits = candidates.symbols.filter((s) => s.startsWith(lastWord));
    const allHits = [...fileHits, ...symbolHits];

    return [allHits, lastWord];
  };
}

function getNestedProperty(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setNestedProperty(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      !(part in current) ||
      current[part] == null ||
      typeof current[part] !== "object"
    ) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}
