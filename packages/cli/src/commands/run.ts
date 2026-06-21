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
import { resolveSafePath, generateId } from "@orbit-ai/shared";
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
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import readline from "readline";
import { SymbolIndexer } from "@orbit-ai/context-engine";
import { execSync } from "child_process";
import { PermissionEngine } from "@orbit-ai/permissions";
import { expandCustomCommand, loadCustomCommands } from "./customCommands.js";

let currentTui: FullscreenTui | null = null;

const BUILTIN_SLASH_COMMANDS = [
  "/help",
  "/status",
  "/config",
  "/model",
  "/chat",
  "/commit",
  "/exit",
  "/quit",
  "/rollback",
  "/timeline",
  "/rewind",
  "/clear",
  "/compact",
  "/history",
  "/edit",
  "/inspect",
  "/doc",
  "/diagnose",
  "/resolve",
  "/references",
  "/run",
  "/grep",
  "/api",
  "/register",
  "/language",
  "/fork",
  "/mode",
  "/ask",
  "/code",
  "/copy",
  "/copy-context",
  "/git",
  "/tokens",
  "/read-only",
  "/readonly",
  "/new",
  "/reset",
  "/delete",
  "/rm",
  "/del",
  "/btw",
  "/memory",
  "/commands",
] as const;

export function previousCodePointIndex(text: string, index: number): number {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  if (safeIndex === 0) return 0;
  const previous = text.charCodeAt(safeIndex - 1);
  if (previous >= 0xdc00 && previous <= 0xdfff && safeIndex >= 2) {
    const leading = text.charCodeAt(safeIndex - 2);
    if (leading >= 0xd800 && leading <= 0xdbff) {
      return safeIndex - 2;
    }
  }
  return safeIndex - 1;
}

export function nextCodePointIndex(text: string, index: number): number {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  if (safeIndex >= text.length) return text.length;
  const leading = text.charCodeAt(safeIndex);
  if (leading >= 0xd800 && leading <= 0xdbff && safeIndex + 1 < text.length) {
    const trailing = text.charCodeAt(safeIndex + 1);
    if (trailing >= 0xdc00 && trailing <= 0xdfff) {
      return safeIndex + 2;
    }
  }
  return safeIndex + 1;
}

export function parseMouseWheelDirection(input: string): "up" | "down" | null {
  const match = input.match(/\x1b\[<(\d+);\d+;\d+[mM]/);
  if (!match) return null;
  const button = Number(match[1]);
  if ((button & 64) === 0) return null;
  return (button & 1) === 0 ? "up" : "down";
}

export function printOutput(text: string, raw = false) {
  if (currentTui && currentTui.isActive) {
    currentTui.addSystemMessage(text, raw);
  } else {
    console.log(text);
  }
}

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
  public isActive = false;
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
  private totalInputTokens = 0;
  private totalCacheReadTokens = 0;
  private totalOutputTokens = 0;
  private budgetLimit = 0;

  private resolveInput: ((val: string | null) => void) | null = null;
  private activeRunnable: { abort: () => void } | null = null;
  private thinkingKeypressListener: ((str: string, key: any) => void) | null =
    null;
  public pendingGuidedStatement: string | null = null;

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
    sessions: string[];
  } | null = null;
  private modelNameGetter: () => string = () => this.modelName;
  private permissionsMode = "normal";
  private hideAutocomplete = false;

  private cachedPlanLines: string[] = [];
  private lastPlanReadTime = 0;
  private activeContextFiles: Array<{
    path: string;
    reason: string;
    readOnly?: boolean;
  }> = [];
  private cachedGitSummary: {
    branch: string;
    added: number;
    modified: number;
    deleted: number;
  } | null = null;
  private lastGitSummaryReadTime = 0;
  private historyScrollOffset = 0;
  private maxHistoryScrollOffset = 0;
  private lastHistoryLineCount = 0;
  private hasNewOutputWhileScrolled = false;

  private getPlanLines(): string[] {
    const now = Date.now();
    if (now - this.lastPlanReadTime < 2000) {
      return this.cachedPlanLines;
    }
    this.lastPlanReadTime = now;
    const planPath2 = join(this.cwd, ".orbit", "task.md");
    const planPath1 = join(this.cwd, "task.md");
    let planPath = "";
    if (existsSync(planPath2)) {
      planPath = planPath2;
    } else if (existsSync(planPath1)) {
      planPath = planPath1;
    }
    if (!planPath) {
      this.cachedPlanLines = [];
      return [];
    }
    try {
      const content = readFileSync(planPath, "utf8");
      const lines = content.split("\n");
      const planItems: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith("- [ ]") ||
          trimmed.startsWith("- [/]") ||
          trimmed.startsWith("- [x]")
        ) {
          planItems.push(trimmed);
        }
      }
      this.cachedPlanLines = planItems;
    } catch {
      this.cachedPlanLines = [];
    }
    return this.cachedPlanLines;
  }

  public setPermissionsMode(mode: string) {
    this.permissionsMode = mode;
  }

  public setModelNameGetter(getter: () => string) {
    this.modelNameGetter = getter;
  }

  public setActiveRunnable(runnable: { abort: () => void } | null) {
    this.activeRunnable = runnable;
  }

  constructor(
    private cwd: string,
    private modelName: string,
    private version: string,
    private config?: any,
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
    this.loadInputHistory();
  }

  public setCandidates(candidates: any) {
    this.candidates = candidates;
  }

  private getHistoryFilePath(): string {
    return join(homedir(), ".orbit", "input_history.json");
  }

  private loadInputHistory() {
    try {
      const filePath = this.getHistoryFilePath();
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.inputHistory = parsed.filter((x) => typeof x === "string");
        }
      }
    } catch {
      this.inputHistory = [];
    }
  }

  private saveInputHistory() {
    try {
      const filePath = this.getHistoryFilePath();
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        filePath,
        JSON.stringify(this.inputHistory, null, 2),
        "utf8",
      );
    } catch {
      // Ignore
    }
  }

  public addSystemMessage(text: string, raw = false) {
    if (!text) return;
    this.history.push({
      role: "system",
      text: text,
    });
    this.render();
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
    const mouseMode =
      this.config?.tui?.mouse !== false ? "\x1b[?1000h\x1b[?1006h" : "";
    process.stdout.write(`\x1b[?1049h${mouseMode}\x1b[?25l`);
    process.stdout.on("resize", this.onResize);
    this.render();
  }

  public stop() {
    if (!this.isActive) return;
    this.isActive = false;
    process.stdout.off("resize", this.onResize);
    process.stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?1049l\x1b[?25h");
    this.hasWrittenStdoutSinceStop = false;
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    this.renderPending = false;
  }

  public dispose() {
    this.stopThinkingInput();
    this.stop();
    if (this.thoughtTimer) {
      clearInterval(this.thoughtTimer);
      this.thoughtTimer = null;
    }
    if (this.ctrlCTimeout) {
      clearTimeout(this.ctrlCTimeout);
      this.ctrlCTimeout = null;
    }
    if (process.stdin.setRawMode && process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write = this.originalWrite as typeof process.stdout.write;
  }

  private getGitSummary() {
    const now = Date.now();
    if (this.cachedGitSummary && now - this.lastGitSummaryReadTime < 1500) {
      return this.cachedGitSummary;
    }

    const summary = {
      branch: "no-git",
      added: 0,
      modified: 0,
      deleted: 0,
    };
    try {
      summary.branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      const statusOutput = execSync("git status --porcelain", {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      for (const line of statusOutput.split("\n")) {
        if (!line) continue;
        const code = line.substring(0, 2);
        if (code.includes("A") || code.includes("?")) {
          summary.added++;
        } else if (code.includes("M") || code.includes("R")) {
          summary.modified++;
        } else if (code.includes("D")) {
          summary.deleted++;
        }
      }
    } catch {
      // Non-git workspaces are valid.
    }
    this.cachedGitSummary = summary;
    this.lastGitSummaryReadTime = now;
    return summary;
  }

  private getWheelScrollLines(): number {
    const configured = Number(this.config?.tui?.scrollSpeed ?? 50);
    return Math.max(1, Math.min(20, Math.ceil(configured / 5)));
  }

  private scrollHistory(delta: number): void {
    this.historyScrollOffset = Math.max(
      0,
      Math.min(this.maxHistoryScrollOffset, this.historyScrollOffset + delta),
    );
    if (this.historyScrollOffset === 0) {
      this.hasNewOutputWhileScrolled = false;
    }
    this.render();
  }

  private handleScrollInput(str: string, key: any): boolean {
    const wheelDirection = parseMouseWheelDirection(str);
    if (wheelDirection) {
      const lines = this.getWheelScrollLines();
      this.scrollHistory(wheelDirection === "up" ? lines : -lines);
      return true;
    }

    const pageSize = Math.max(3, Math.floor((process.stdout.rows || 24) * 0.6));
    if (key?.name === "pageup") {
      this.scrollHistory(pageSize);
      return true;
    }
    if (key?.name === "pagedown") {
      this.scrollHistory(-pageSize);
      return true;
    }
    if (key?.name === "home" && key?.ctrl) {
      this.scrollHistory(this.maxHistoryScrollOffset);
      return true;
    }
    if (key?.name === "end" && this.historyScrollOffset > 0) {
      this.historyScrollOffset = 0;
      this.hasNewOutputWhileScrolled = false;
      this.render();
      return true;
    }
    return false;
  }

  public startThinkingInput() {
    if (!this.isActive) return;
    this.stopThinkingInput();

    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    this.thinkingKeypressListener = (str: string, key: any) => {
      if (!this.isActive) {
        this.stopThinkingInput();
        return;
      }

      if (this.handleScrollInput(str, key)) {
        return;
      }

      if (key && key.ctrl && key.name === "c") {
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = "";
          this.cursorPosition = 0;
          this.render();
        } else {
          if (this.activeRunnable) {
            this.activeRunnable.abort();
          }
        }
        return;
      }

      if (key && (key.name === "return" || key.name === "enter")) {
        const submitted = this.inputBuffer;
        if (submitted.trim()) {
          this.pendingGuidedStatement = submitted;
          if (this.activeRunnable) {
            this.activeRunnable.abort();
          }
        }
        this.inputBuffer = "";
        this.cursorPosition = 0;
        this.render();
        return;
      }

      if (key && key.ctrl) {
        return;
      }

      if (key && key.name === "backspace") {
        if (this.cursorPosition > 0) {
          const previousIndex = previousCodePointIndex(
            this.inputBuffer,
            this.cursorPosition,
          );
          this.inputBuffer =
            this.inputBuffer.slice(0, previousIndex) +
            this.inputBuffer.slice(this.cursorPosition);
          this.cursorPosition = previousIndex;
          this.render();
        }
        return;
      }

      if (key && key.name === "delete") {
        if (this.cursorPosition < this.inputBuffer.length) {
          const nextIndex = nextCodePointIndex(
            this.inputBuffer,
            this.cursorPosition,
          );
          this.inputBuffer =
            this.inputBuffer.slice(0, this.cursorPosition) +
            this.inputBuffer.slice(nextIndex);
          this.render();
        }
        return;
      }

      if (key && key.name === "left") {
        if (this.cursorPosition > 0) {
          this.cursorPosition = previousCodePointIndex(
            this.inputBuffer,
            this.cursorPosition,
          );
          this.render();
        }
        return;
      }

      if (key && key.name === "right") {
        if (this.cursorPosition < this.inputBuffer.length) {
          this.cursorPosition = nextCodePointIndex(
            this.inputBuffer,
            this.cursorPosition,
          );
          this.render();
        }
        return;
      }

      if (str && !/[\u0000-\u001f\u007f]/.test(str)) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPosition) +
          str +
          this.inputBuffer.slice(this.cursorPosition);
        this.cursorPosition += str.length;
        this.render();
      }
    };

    process.stdin.on("keypress", this.thinkingKeypressListener);
  }

  public stopThinkingInput() {
    if (this.thinkingKeypressListener) {
      process.stdin.removeListener("keypress", this.thinkingKeypressListener);
      this.thinkingKeypressListener = null;
    }
  }

  private getActiveMatches(): string[] {
    if (!this.candidates || !this.inputBuffer.startsWith("/")) return [];
    if (this.hideAutocomplete) return [];

    const line = this.inputBuffer;
    const parts = line.split(/\s+/);

    if (parts[0] === "/add" && line.includes(" ")) {
      const query = line.slice(5).trim();
      const hits = (this.candidates.files || [])
        .filter((f) => f.toLowerCase().includes(query.toLowerCase()))
        .map((f) => `/add ${f}`);
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/drop" && line.includes(" ")) {
      const query = line.slice(6).trim();
      const hits = (this.candidates.files || [])
        .filter((f) => f.toLowerCase().includes(query.toLowerCase()))
        .map((f) => `/drop ${f}`);
      if (hits.length > 0) return hits;
    }

    if (
      (parts[0] === "/read-only" || parts[0] === "/readonly") &&
      line.includes(" ")
    ) {
      const prefix = parts[0];
      const query = line.slice(prefix.length + 1).trim();
      const hits = (this.candidates.files || [])
        .filter((f) => f.toLowerCase().includes(query.toLowerCase()))
        .map((f) => `${prefix} ${f}`);
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/references" && line.includes(" ")) {
      const query = line.slice(12).trim();
      const hits = (this.candidates.symbols || [])
        .filter((s) => s.toLowerCase().startsWith(query.toLowerCase()))
        .map((s) => `/references ${s}`);
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/model" && line.includes(" ")) {
      const query = line.slice(7).trim();
      const defaultProvider = this.config?.provider?.default;
      const providerConfig = this.config?.providers?.[defaultProvider];
      const providerType = providerConfig?.type;

      let models: string[] = [];
      if (
        providerType === "anthropic" ||
        providerType === "anthropic-compatible"
      ) {
        models = [
          "claude-3-5-sonnet-latest",
          "claude-3-5-haiku-latest",
          "claude-3-opus-latest",
        ];
      } else if (providerType === "openai") {
        models = ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"];
      } else if (providerType === "openai-compatible") {
        if (defaultProvider?.includes("deepseek")) {
          models = [
            "deepseek-v4-flash",
            "deepseek-v4-pro",
            "deepseek-chat",
            "deepseek-reasoner",
          ];
        } else {
          models = [
            "gpt-4o",
            "gpt-4o-mini",
            "deepseek-chat",
            "deepseek-reasoner",
          ];
        }
      } else if (providerType === "ollama") {
        models = ["qwen2.5-coder:7b", "qwen2.5-coder:1.5b", "llama3"];
      } else {
        models = [
          "deepseek-v4-flash",
          "deepseek-v4-pro",
          "gpt-4o",
          "o3-mini",
          "claude-3-5-sonnet-latest",
        ];
      }

      const hits = models
        .filter((m) => m.toLowerCase().includes(query.toLowerCase()))
        .map((m) => `/model ${m}`);
      if (hits.length > 0) return hits;
    }

    if (parts[0] === "/chat" && line.includes(" ")) {
      // 1. If it's just "/chat " completing the subcommand
      if (parts.length <= 2) {
        const subcommands = ["list", "ls", "new", "delete", "rm", "switch"];
        const hits = subcommands
          .map((sub) => `/chat ${sub}`)
          .filter((c) => c.startsWith(line));
        if (hits.length > 0) return hits;
      }

      // 2. If it's "/chat delete <query>", "/chat switch <query>", "/chat rm <query>"
      if (parts.length >= 3 && ["delete", "rm", "switch"].includes(parts[1])) {
        const cmd = parts[0];
        const sub = parts[1];
        const query = parts.slice(2).join(" ");
        const prefix = `${cmd} ${sub} `;
        const hits = (this.candidates.sessions || [])
          .filter((s) => {
            const lowerS = s.toLowerCase();
            const lowerQ = query.toLowerCase();
            return (
              lowerS.startsWith(lowerQ) ||
              s
                .replace(/^sess_/, "")
                .toLowerCase()
                .startsWith(lowerQ)
            );
          })
          .map((s) => `${prefix}${s}`);
        if (hits.length > 0) return hits;
      }
    }

    if (parts[0] === "/fork" && line.includes(" ")) {
      // 1. If it's just "/fork " completing the subcommand
      if (parts.length <= 2) {
        const subcommands = ["tree", "switch"];
        const hits = subcommands
          .map((sub) => `/fork ${sub}`)
          .filter((c) => c.startsWith(line));
        if (hits.length > 0) return hits;
      }

      // 2. If it's "/fork switch <query>"
      if (parts.length >= 3 && parts[1] === "switch") {
        const cmd = parts[0];
        const sub = parts[1];
        const query = parts.slice(2).join(" ");
        const prefix = `${cmd} ${sub} `;
        const hits = (this.candidates.sessions || [])
          .filter((s) => {
            const lowerS = s.toLowerCase();
            const lowerQ = query.toLowerCase();
            return (
              lowerS.startsWith(lowerQ) ||
              s
                .replace(/^sess_/, "")
                .toLowerCase()
                .startsWith(lowerQ)
            );
          })
          .map((s) => `${prefix}${s}`);
        if (hits.length > 0) return hits;
      }
    }

    if (
      (parts[0] === "/delete" || parts[0] === "/rm" || parts[0] === "/del") &&
      line.includes(" ")
    ) {
      const prefix = parts[0];
      const query = line.slice(prefix.length + 1).trim();
      const hits = (this.candidates.sessions || [])
        .filter((s) => {
          const lowerS = s.toLowerCase();
          const lowerQ = query.toLowerCase();
          return (
            lowerS.startsWith(lowerQ) ||
            s
              .replace(/^sess_/, "")
              .toLowerCase()
              .startsWith(lowerQ)
          );
        })
        .map((s) => `${prefix} ${s}`);
      if (hits.length > 0) return hits;
    }

    // Default: Match main commands
    return this.candidates.commands.filter((c) => c.startsWith(line));
  }

  private getSuggestion(): string {
    const line = this.inputBuffer;
    const matches = this.getActiveMatches();
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
    const hits = this.getActiveMatches();
    return { hits, lastWord: this.inputBuffer };
  }

  public setCost(
    cost: number,
    inputTokens = 0,
    cacheReadTokens = 0,
    outputTokens = 0,
  ) {
    this.sessionCost = cost;
    this.totalInputTokens = inputTokens;
    this.totalCacheReadTokens = cacheReadTokens;
    this.totalOutputTokens = outputTokens;
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
    this.activeContextFiles = loop.getRelevantFiles() || [];
    const loopHistory = loop.getHistory();
    if (loopHistory.length === 0) {
      this.render();
      return;
    }

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
    this.historyScrollOffset = 0;
    this.hasNewOutputWhileScrolled = false;
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

        if (this.handleScrollInput(str, key)) {
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
          this.historyScrollOffset = 0;
          this.hasNewOutputWhileScrolled = false;

          if (submitted.trim()) {
            this.history.push({ role: "user", text: submitted });
            if (this.inputHistory[this.inputHistory.length - 1] !== submitted) {
              this.inputHistory.push(submitted);
              this.saveInputHistory();
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
            const matches = this.getActiveMatches();
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
            const matches = this.getActiveMatches();
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
            this.cursorPosition = previousCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.render();
          }
          return;
        }

        if (key && key.name === "right") {
          if (this.cursorPosition < this.inputBuffer.length) {
            this.cursorPosition = nextCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
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
            const matches = this.getActiveMatches();
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

        if (key && key.ctrl && key.name === "l") {
          this.history = [];
          this.render();
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
            const nextIndex = nextCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.inputBuffer =
              this.inputBuffer.substring(0, this.cursorPosition) +
              this.inputBuffer.substring(nextIndex);
            this.render();
          }
          return;
        }

        if (key && key.name === "backspace") {
          this.activeCommandIndex = 0;
          this.hideAutocomplete = false;
          if (this.cursorPosition > 0) {
            const previousIndex = previousCodePointIndex(
              this.inputBuffer,
              this.cursorPosition,
            );
            this.inputBuffer =
              this.inputBuffer.substring(0, previousIndex) +
              this.inputBuffer.substring(this.cursorPosition);
            this.cursorPosition = previousIndex;
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
    const minInterval = 60;
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
    const isInputActive =
      isWaitingInput || this.thinkingKeypressListener !== null;
    const hasInput = isInputActive && this.inputBuffer.length > 0;
    const placeholder = isWaitingInput ? "Ask anything..." : "";
    const budgetPct =
      Math.min(
        100,
        Math.round((this.sessionCost / (this.budgetLimit || 10)) * 100),
      ) + "%";

    // A.1 构建底部的圆角输入框与状态行以及指令匹配浮窗
    const boxWidth = columns - 4;
    const wrapWidth = Math.max(8, boxWidth - 14);
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

    // A.2 只有以 / 开头且正在等待输入时，渲染指令下拉浮窗
    if (isWaitingInput) {
      const matches = this.getActiveMatches();

      if (matches.length > 0) {
        const isZh = this.config?.language === "zh";
        const cmdHints: Record<string, string> = isZh
          ? {
              "/help": "查看系统命令的详细帮助与指南",
              "/status": "实时诊断当前会话的健康与资源状态",
              "/config": "查看与修改本地/全局的运行配置参数",
              "/model": "动态切换正在使用的 AI 语言大模型",
              "/chat": "会话管理器 (支持子命令: list, new, delete, switch)",
              "/chat list": "展示所有已保存的历史对话会话",
              "/chat ls": "展示所有已保存的历史对话会话",
              "/chat new": "启动并创建一个全新的对话会话",
              "/chat delete": "移除不需要的历史对话会话",
              "/chat rm": "移除不需要的历史对话会话",
              "/chat switch": "快速切换到指定的历史对话会话",
              "/commit": "自动暂存工作区修改并生成 Git 提交",
              "/diff": "可视化比对当前工作区的所有代码变更",
              "/test": "自动化运行项目中的单元测试组件",
              "/add": "将选定的文件或代码资产添加到当前上下文",
              "/drop": "从当前对话上下文中移除选定的资产",
              "/context": "查看并深度分析当前上下文中的文件与代码资产",
              "/exit": "安全终止并关闭当前的终端会话",
              "/quit": "安全终止并关闭当前的终端会话",
              "/rollback": "一键撤销并回滚自会话启动以来的所有修改",
              "/timeline": "查看当前会话可恢复的文件检查点时间线",
              "/rewind": "将工作区回退到指定的持久化检查点",
              "/clear": "清空当前终端屏幕的所有历史会话渲染",
              "/compact": "智能压缩当前对话历史以节省 Prompt 词量",
              "/history": "浏览并重放执行过的历史命令列表",
              "/edit": "交互式编辑工作区与代理的核心配置文件",
              "/inspect": "深度分析并检查当前工作区的工程结构",
              "/doc": "为工作区代码自动分析并生成 JSDoc 文档",
              "/diagnose": "智能扫描并一键修复工作区中的构建/编译错误",
              "/resolve": "自动检测并半自动解决工作区中的代码合并冲突",
              "/references": "快速查找指定符号/类/函数在工作区中的引用",
              "/run": "在外部终端沙箱中直接执行 Shell 命令",
              "/grep": "在工作区文件内容中全局检索特定字符串/正则表达式",
              "/language": "一键在英文与中文之间切换终端显示语言",
              "/api": "交互式配置与测试模型提供商的 API 密钥及地址",
              "/register": "为代理运行时动态注册并挂载新的外部工具",
              "/fork": "分支/复刻当前会话到新会话",
              "/mode": "动态切换系统安全确认模式 (strict, normal, auto, plan)",
              "/ask": "一键切换至 strict 安全模式 (只读/高安全级)",
              "/code": "一键切换至 normal 安全模式 (默认可编辑模式)",
              "/copy": "拷贝 AI 的上一条回复到系统剪贴板",
              "/copy-context": "拷贝当前活动上下文文件列表到系统剪贴板",
              "/git": "在沙箱终端中直接执行 Git 命令",
              "/tokens": "展示当前会话详细的 Token 使用量与估算成本",
              "/read-only": "添加文件到当前上下文为只读参考资料",
              "/readonly": "添加文件到当前上下文为只读参考资料",
              "/btw": "问一个快捷问题而不污染当前会话的上下文历史",
              "/memory": "查看项目本地的 AGENTS.md 规则与记忆文件",
              "/commands": "列出项目级与用户级自定义提示命令",
              "/new": "创建一个全新的对话会话 (快捷键)",
              "/reset": "重置当前会话历史开始新对话 (快捷键)",
              "/delete": "删除指定会话或弹出删除菜单",
              "/rm": "删除指定会话或弹出删除菜单",
              "/del": "删除指定会话或弹出删除菜单",
            }
          : {
              "/help": "Display detailed help and commands reference",
              "/status": "Diagnose session health, token usage, and limits",
              "/config": "View and edit local or global configuration",
              "/model": "Switch the active language model dynamically",
              "/chat":
                "Manage chat sessions (subcommands: list, new, delete, switch)",
              "/chat list": "List all saved agent chat sessions",
              "/chat ls": "List all saved agent chat sessions",
              "/chat new": "Initialize and start a fresh chat session",
              "/chat delete": "Remove a saved session from the manager",
              "/chat rm": "Remove a saved session from the manager",
              "/chat switch": "Switch focus to a specific saved session",
              "/commit": "Automatically stage changes and create Git commit",
              "/diff": "Interactively view file diffs in the workspace",
              "/test": "Run workspace test suites automatically",
              "/add": "Add files or code symbols to prompt context",
              "/drop": "Remove selected assets from prompt context",
              "/context":
                "Inspect the assembled active context package and assets",
              "/exit": "Safely terminate and exit the active session",
              "/quit": "Safely terminate and exit the active session",
              "/rollback": "Revert all source edits made during this session",
              "/timeline": "Inspect the persistent checkpoint timeline",
              "/rewind": "Rewind the workspace to a selected checkpoint",
              "/clear": "Clear the terminal screen and scrollback buffer",
              "/compact": "Compress chat history to optimize token usage",
              "/history": "View and replay previously executed commands",
              "/edit": "Configure agent options via interactive editor",
              "/inspect": "Inspect workspace structure and boundary status",
              "/doc":
                "Generate high-quality documentation for codebase symbols",
              "/diagnose": "Scan workspace and diagnose/fix build issues",
              "/resolve": "Scan and help resolve Git merge conflicts",
              "/references": "Find references and usages of a codebase symbol",
              "/run":
                "Execute a shell command directly in the terminal sandbox",
              "/grep":
                "Perform global search for patterns across workspace files",
              "/language": "Switch display language between English & Chinese",
              "/api": "Configure base URL and credentials for APIs",
              "/register": "Register new runtime tools dynamically",
              "/fork": "Fork the current session history into a branch",
              "/mode": "Switch permission mode (strict, normal, auto, plan)",
              "/ask": "Shortcut for strict read-only mode",
              "/code": "Shortcut for normal default editing mode",
              "/copy": "Copy last assistant response to clipboard",
              "/copy-context": "Copy active context files list to clipboard",
              "/git": "Execute a git command in the sandbox",
              "/tokens": "Display session token usage and details",
              "/read-only": "Add files to context as read-only references",
              "/readonly": "Add files to context as read-only references",
              "/btw":
                "Ask a quick side-question without polluting active history",
              "/memory": "View the workspace memory / AGENTS.md guidelines",
              "/commands": "List project and user custom prompt commands",
              "/new": "Create a brand new chat session (shortcut)",
              "/reset": "Reset history and start a fresh session (shortcut)",
              "/delete": "Delete a session by ID/idx or open deletion menu",
              "/rm": "Delete a session by ID/idx or open deletion menu",
              "/del": "Delete a session by ID/idx or open deletion menu",
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

        const maxPopupWidth = Math.min(86, Math.max(30, columns - 8));
        const formattedMatches = visibleMatches.map((cmd) => {
          const isSelected =
            visibleMatches.indexOf(cmd) + startIdx === this.activeCommandIndex;
          const prefix = isSelected ? " ❯ " : "   ";
          const leftPart = `${prefix}${cmd}`;
          const leftW = this.getStringWidth(leftPart);

          let hint = cmdHints[cmd] || "";
          if (!hint) {
            if (
              cmd.startsWith("/chat delete ") ||
              cmd.startsWith("/chat rm ")
            ) {
              hint = isZh ? "删除该会话" : "Delete this session";
            } else if (cmd.startsWith("/chat switch ")) {
              hint = isZh ? "切换到该会话" : "Switch to this session";
            } else if (cmd.startsWith("/fork switch ")) {
              hint = isZh
                ? "切换到指定的会话分支"
                : "Switch to specified session branch";
            } else if (cmd === "/fork tree") {
              hint = isZh
                ? "展示所有会话分支的树状关系"
                : "Display session branch lineage tree";
            }
          }

          let rightPart = "";
          let rightW = 0;
          if (hint) {
            const rawRightPart = hint;
            const rawRightW = this.getStringWidth(rawRightPart);
            const maxRightW = maxPopupWidth - leftW - 2;
            if (rawRightW <= maxRightW) {
              rightPart = rawRightPart;
              rightW = rawRightW;
            } else if (maxRightW >= 5) {
              const maxHintW = maxRightW - 3;
              const truncatedHint = this.truncateToWidth(hint, maxHintW);
              rightPart = `${truncatedHint}...`;
              rightW = this.getStringWidth(rightPart);
            }
          }

          return { cmd, isSelected, leftPart, leftW, rightPart, rightW };
        });

        const popupWidth = maxPopupWidth;

        bottomLines.push(morandi.gray("  ╭" + "─".repeat(popupWidth) + "╮"));
        for (const fm of formattedMatches) {
          const spacingWidth = popupWidth - fm.leftW - fm.rightW;
          const spacing = " ".repeat(spacingWidth);

          const formattedLine = fm.isSelected
            ? morandi.accent(fm.leftPart + spacing) + morandi.dim(fm.rightPart)
            : morandi.gray(fm.leftPart + spacing) + morandi.dim(fm.rightPart);

          bottomLines.push(
            morandi.gray("  │") + formattedLine + morandi.gray("│"),
          );
        }
        bottomLines.push(morandi.gray("  ╰" + "─".repeat(popupWidth) + "╯"));
      }
    }

    // A.3 压入输入框
    bottomLines.push(...boxContentLines);

    // A.4 构建底部状态行
    const mode = this.permissionsMode.toUpperCase();

    let statusText = "";
    if (this.historyScrollOffset > 0) {
      const newOutput = this.hasNewOutputWhileScrolled
        ? this.config?.language === "zh"
          ? " · 有新输出"
          : " · new output"
        : "";
      statusText =
        morandi.accent(
          this.config?.language === "zh"
            ? `↑ 历史 ${this.historyScrollOffset} 行`
            : `↑ history ${this.historyScrollOffset} lines`,
        ) + morandi.warn(newOutput);
    } else if (this.ctrlCPressedOnce) {
      statusText = morandi.warn("Press Ctrl+C again to exit");
    } else {
      const cleanModel =
        this.modelNameGetter().split("/").pop() || this.modelNameGetter();
      statusText =
        morandi.completed("●") +
        " " +
        morandi.white(`${mode} MODE`) +
        morandi.gray("  ·  ") +
        morandi.accent(cleanModel) +
        morandi.gray("  ·  ") +
        morandi.dim(`attempt: ${this.currentAttempt || 1}`);
    }

    let keybindings =
      this.historyScrollOffset > 0
        ? morandi.gray("[End]") +
          morandi.dim(this.config?.language === "zh" ? " 返回底部" : " Bottom")
        : columns >= 88
          ? [
              morandi.gray("[^C]") + morandi.dim(" Cancel"),
              morandi.gray("[^L]") + morandi.dim(" Clear"),
              morandi.gray("[^P]") + morandi.dim(" Cmds"),
            ].join("  ")
          : columns >= 62
            ? [
                morandi.gray("[^C]") + morandi.dim(" Cancel"),
                morandi.gray("[^P]") + morandi.dim(" Cmds"),
              ].join("  ")
            : morandi.gray("[^C]") + morandi.dim(" Exit");

    let statusTextLength = this.getStringWidth(statusText);
    let keybindingsLength = this.getStringWidth(keybindings);
    if (statusTextLength + keybindingsLength > columns - 8) {
      const compactMode = `${mode.slice(0, 6)} · ${this.currentAttempt || 1}`;
      statusText = morandi.completed("●") + " " + morandi.white(compactMode);
      statusTextLength = this.getStringWidth(statusText);
    }
    if (statusTextLength + keybindingsLength > columns - 8) {
      keybindings = morandi.gray("[^C]");
      keybindingsLength = this.getStringWidth(keybindings);
    }
    const spacing = Math.max(
      1,
      columns - 6 - statusTextLength - keybindingsLength,
    );

    bottomLines.push("  " + statusText + " ".repeat(spacing) + keybindings);

    const bottomHeight = bottomLines.length;

    // 全屏渲染逻辑（当无法增量时）
    const cleanModel = this.modelNameGetter().replace(/\[1m\]/g, "");

    // 1. 获取 Git 当前分支与状态（短时缓存，避免流式输出期间阻塞重绘）
    const gitSummary = this.getGitSummary();
    const gitBranch = gitSummary.branch;

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

    // Safety check to prevent left/right overflow of the header
    const availableWidth = Math.max(10, columns - 2 - maxLogoW - 2 - 20 - 2);

    let branchText = "";
    if (gitBranch !== "no-git") {
      const stats: string[] = [];
      if (gitSummary.added > 0) stats.push(`+${gitSummary.added}`);
      if (gitSummary.modified > 0) stats.push(`~${gitSummary.modified}`);
      if (gitSummary.deleted > 0) stats.push(`-${gitSummary.deleted}`);
      const gitStatusStats = stats.length > 0 ? ` (${stats.join(" ")})` : "";
      const maxBranchLen = 12;
      const displayBranch =
        gitBranch.length > maxBranchLen
          ? gitBranch.substring(0, maxBranchLen - 3) + "..."
          : gitBranch;
      branchText = `  ${morandi.dim("·")}  branch:${morandi.asst(displayBranch)}${gitStatusStats ? morandi.accent(gitStatusStats) : ""}`;
    }

    // Helper to truncate path from middle/beginning to make it fit maxPathWidth
    const truncatePath = (p: string, maxLength: number): string => {
      if (p.length <= maxLength) return p;
      const parts = p.split("/");
      if (parts.length <= 1) {
        return p.substring(p.length - maxLength);
      }
      const lastPart = parts[parts.length - 1];
      if (lastPart.length + 4 > maxLength) {
        return "..." + lastPart.substring(lastPart.length - (maxLength - 3));
      }
      let result = lastPart;
      for (let i = parts.length - 2; i >= 0; i--) {
        const nextResult = parts[i] + "/" + result;
        if (nextResult.length + 4 > maxLength) {
          return ".../" + result;
        }
        result = nextResult;
      }
      return result;
    };

    const pathLabel = "workspace: ";
    const branchWidth =
      gitBranch !== "no-git" ? 5 + Math.min(12, gitBranch.length) : 0;
    const maxPathWidth = Math.max(
      6,
      availableWidth - pathLabel.length - branchWidth,
    );
    const displayPath = truncatePath(shortCwd, maxPathWidth);

    const hitRate =
      this.totalInputTokens > 0
        ? (this.totalCacheReadTokens / this.totalInputTokens) * 100
        : 0;
    let cacheText = `[cache] hit: ${hitRate.toFixed(0)}% (${(this.totalCacheReadTokens / 1000).toFixed(0)}k/${(this.totalInputTokens / 1000).toFixed(0)}k tokens)`;
    if (this.getStringWidth(cacheText) > availableWidth) {
      cacheText = `[cache] hit: ${hitRate.toFixed(0)}% (${(this.totalCacheReadTokens / 1000).toFixed(0)}k/${(this.totalInputTokens / 1000).toFixed(0)}k)`;
    }
    if (this.getStringWidth(cacheText) > availableWidth) {
      cacheText = `[cache] hit: ${hitRate.toFixed(0)}%`;
    }

    const cleanHeaderModel = cleanModel.split("/").pop() || cleanModel;
    let headerLines: string[];
    if (columns < 76) {
      const modelWidth = Math.max(8, columns - 16);
      const displayModel =
        this.getStringWidth(cleanHeaderModel) > modelWidth
          ? this.truncateToWidth(cleanHeaderModel, modelWidth - 3) + "..."
          : cleanHeaderModel;
      const compactPath = truncatePath(shortCwd, Math.max(8, columns - 15));
      const compactBranch =
        gitBranch === "no-git"
          ? ""
          : ` · ${gitBranch.length > 12 ? gitBranch.slice(0, 9) + "..." : gitBranch}`;
      headerLines = [
        `  ${morandi.whiteBold("O R B I T")} ${morandi.dim("·")} ${morandi.accent(displayModel)}`,
        `  ${morandi.dim("workspace:")} ${morandi.gray(compactPath)}`,
        `  ${morandi.dim(cacheText)}${morandi.dim(compactBranch)}`,
      ];
    } else {
      const headerLine1 = `  ${logoLines[0]}${pad0}  ${morandi.whiteBold("O R B I T")} ${morandi.dim("·")} ${morandi.accent(cleanHeaderModel)}`;
      const headerLine2 = `  ${logoLines[1]}${pad1}  ${" ".repeat(20)}${morandi.dim("workspace:")} ${morandi.gray(displayPath)}${branchText}`;
      const headerLine3 = `  ${logoLines[2]}${pad2}  ${" ".repeat(20)}${morandi.dim(cacheText)}`;
      const headerLine4 = `  ${logoLines[3]}${pad3}`;
      headerLines = [headerLine1, headerLine2, headerLine3, headerLine4];
    }

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
    const uBorder = "    ";
    const aBorder = "    ";

    for (const turn of turns) {
      // Render User Turn
      renderedLines.push("    " + morandi.userBold("👤 User"));
      renderedLines.push(uBorder);

      const userLines = turn.user.text.split("\n");
      const wrappedUserLines: string[] = [];
      for (const line of userLines) {
        wrappedUserLines.push(...this.wrapLine(line, columns - 10));
      }
      for (const line of wrappedUserLines) {
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

          if (isThinkingNow) {
            asstLines.push(
              `${dotChar} ` + morandi.accent(`Thinking... ${timeStr}`),
            );
            if (this.currentThinking) {
              const lines = this.currentThinking.split("\n").filter(Boolean);
              const lastLines = lines.slice(-4);
              const maxL = columns - 14;
              for (const line of lastLines) {
                const trimmed = line.trim();
                let displayText = trimmed;
                const displayW = this.getStringWidth(displayText);
                if (displayW > maxL) {
                  displayText =
                    this.truncateToWidth(displayText, maxL - 3) + "...";
                }
                asstLines.push(
                  "    " + morandi.gray("· ") + morandi.dim(displayText),
                );
              }
            }
          } else {
            asstLines.push(
              morandi.gray("🧠 ") + morandi.dim(`Thought for ${timeStr}`),
            );
          }
        }

        if (systemLines.length > 0) {
          asstLines.push(...systemLines);
        }

        if (turn.assistant.text) {
          if (asstLines.length > 0) {
            asstLines.push("");
          }

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

        const wrappedAsstLines: string[] = [];
        for (const line of asstLines) {
          wrappedAsstLines.push(...this.wrapLine(line, columns - 10));
        }

        renderedLines.push(
          "    " + morandi.asstBold(`🤖 Orbit (${cleanModel})`),
        );
        renderedLines.push(aBorder);
        for (const line of wrappedAsstLines) {
          renderedLines.push(aBorder + line);
        }
        renderedLines.push(aBorder);
        renderedLines.push("");
      }
    }

    // A.6 Read Plan Items
    let planText = "";
    const planItems = this.getPlanLines();
    if (planItems.length > 0) {
      const planContent: string[] = [];
      let activeIndex = planItems.findIndex((item) => item.startsWith("- [/]"));
      if (activeIndex === -1) {
        activeIndex = planItems.findIndex((item) => item.startsWith("- [ ]"));
      }
      if (activeIndex === -1) {
        activeIndex = planItems.length - 1;
      }

      planContent.push("  " + morandi.accent("📋 Active Plan:"));

      const completedCount = planItems.filter(
        (item, idx) => item.startsWith("- [x]") && idx < activeIndex,
      ).length;
      if (completedCount > 0) {
        const cleanCompletedText = `${completedCount} step${completedCount > 1 ? "s" : ""} completed`;
        planContent.push(
          "    " +
            morandi.completed("✔") +
            " " +
            morandi.gray(cleanCompletedText),
        );
      }

      const activeItem = planItems[activeIndex];
      if (activeItem) {
        const text = activeItem.substring(5).trim();
        const isCurrentRunning = activeItem.startsWith("- [/]");
        const prefixSymbol = isCurrentRunning
          ? morandi.accent("▸")
          : morandi.dim("○");

        let displayText = text;
        const maxTextLen = columns - 10;
        const displayW = this.getStringWidth(displayText);
        if (displayW > maxTextLen) {
          displayText =
            this.truncateToWidth(displayText, maxTextLen - 3) + "...";
        }
        const coloredText = isCurrentRunning
          ? morandi.whiteBold(displayText)
          : morandi.dim(displayText);
        planContent.push("    " + prefixSymbol + " " + coloredText);
      }
      planText = planContent.join("\n") + "\n\n";
    }

    // A.5 Context files panel
    let contextText = "";
    if (this.activeContextFiles && this.activeContextFiles.length > 0) {
      const contextLines: string[] = [];
      contextLines.push("  " + morandi.accent("📎 Context Files:"));

      const filesStr = this.activeContextFiles
        .map((f) => f.path + ((f as any).readOnly ? " (RO)" : ""))
        .join(", ");
      const maxW = columns - 10;
      const wrappedFiles = this.wrapLine(filesStr, maxW);
      for (const line of wrappedFiles) {
        contextLines.push("    " + morandi.white(line));
      }
      contextText = contextLines.join("\n") + "\n\n";
    }

    const headerText = `${headerLines.join("\n")}\n\n` + planText + contextText;
    const headerHeight = headerText.split("\n").length;

    // 6. 排版与渲染到终端 (带垂直裁剪逻辑，自底向上排布)
    // 留出 1 行用于历史记录与输入框之间的空行间隔
    const maxContentRows = Math.max(1, rows - bottomHeight - headerHeight - 1);

    let flatLines: string[] = [];
    for (const item of renderedLines) {
      flatLines.push(...item.split("\n"));
    }

    if (
      this.historyScrollOffset > 0 &&
      flatLines.length > this.lastHistoryLineCount
    ) {
      this.historyScrollOffset += flatLines.length - this.lastHistoryLineCount;
      this.hasNewOutputWhileScrolled = true;
    }
    this.lastHistoryLineCount = flatLines.length;
    this.maxHistoryScrollOffset = Math.max(
      0,
      flatLines.length - maxContentRows,
    );
    this.historyScrollOffset = Math.min(
      this.historyScrollOffset,
      this.maxHistoryScrollOffset,
    );

    let finalLines: string[] = [];
    let totalLinesCount = 0;

    const visibleEnd = Math.max(0, flatLines.length - this.historyScrollOffset);
    for (let i = visibleEnd - 1; i >= 0; i--) {
      const line = flatLines[i];
      const visibleLen = this.getStringWidth(line);
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

    // Trim trailing empty lines from finalLines to prevent extra blank space at the bottom
    while (
      finalLines.length > 0 &&
      finalLines[finalLines.length - 1]
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
        .trim() === ""
    ) {
      finalLines.pop();
    }

    const gapHeight = finalLines.length > 0 ? 1 : 0;
    const totalHeight =
      headerHeight + finalLines.length + gapHeight + bottomHeight;
    const extraPad = Math.max(0, rows - totalHeight);

    const allLines: string[] = [];
    allLines.push(...headerText.split("\n"));

    if (extraPad > 0) {
      for (let i = 0; i < extraPad; i++) {
        allLines.push("");
      }
    }

    if (finalLines.length > 0) {
      allLines.push(...finalLines);
      // 聊天记录的下限和输入框的长方形边框隔开一行空行
      allLines.push("");
    }

    allLines.push(...bottomLines);
    const rawLines = allLines;

    const staticText = rawLines
      .slice(0, rawLines.length - bottomHeight)
      .join("\n");
    const canIncremental =
      !forceFull &&
      isInputActive &&
      this.cachedStaticLinesCount > 0 &&
      bottomHeight === this.lastRenderedBottomHeight &&
      staticText === this.cachedStaticContent;

    if (canIncremental) {
      // 局部增量重绘
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

    // 缓存静态渲染信息
    this.cachedStaticLinesCount = rawLines.length - bottomHeight;
    this.cachedStaticContent = staticText;
    this.lastRenderedBottomHeight = bottomHeight;

    let finalOutput =
      "\x1b[?25l\x1b[H" +
      rawLines.map((line) => line + "\x1b[K").join("\n") +
      "\x1b[J";

    // 7. 相对光标精确定位与原子打包输出
    let cursorSequence = "";
    if (this.resolveInput || this.thinkingKeypressListener !== null) {
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

  private truncateToWidth(str: string, maxW: number): string {
    let width = 0;
    let result = "";
    for (const char of str) {
      const code = char.codePointAt(0);
      if (code === undefined) continue;
      const charW = this.isFullWidth(code) ? 2 : 1;
      if (width + charW > maxW) {
        break;
      }
      width += charW;
      result += char;
    }
    return result;
  }

  private wrapLine(line: string, maxWidth: number): string[] {
    const cleanLine = line.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      "",
    );
    if (this.getStringWidth(cleanLine) <= maxWidth) {
      return [line];
    }

    const lines: string[] = [];
    let currentLine = "";
    let currentWidth = 0;

    const ansiRegex =
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    let activeColor = "";

    let i = 0;
    while (i < line.length) {
      ansiRegex.lastIndex = i;
      const match = ansiRegex.exec(line);
      if (match && match.index === i) {
        const ansiCode = match[0];
        currentLine += ansiCode;
        if (ansiCode.includes("m") && !ansiCode.includes("[0m")) {
          activeColor = ansiCode;
        } else if (ansiCode.includes("[0m")) {
          activeColor = "";
        }
        i += ansiCode.length;
        continue;
      }

      const char = line.charAt(i);
      const code = line.codePointAt(i);
      let charLen = 1;
      if (code && code > 0xffff) {
        charLen = 2;
      }
      const charStr = line.substring(i, i + charLen);
      const charW = this.isFullWidth(code || 0) ? 2 : 1;

      if (currentWidth + charW > maxWidth) {
        if (activeColor) {
          currentLine += "\x1b[0m";
        }
        lines.push(currentLine);
        currentLine = activeColor + charStr;
        currentWidth = charW;
      } else {
        currentLine += charStr;
        currentWidth += charW;
      }
      i += charLen;
    }

    if (currentLine) {
      lines.push(currentLine);
    }
    return lines;
  }

  private getStringWidth(str: string): number {
    const cleanStr = str.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      "",
    );
    let width = 0;
    for (let i = 0; i < cleanStr.length; i++) {
      const code = cleanStr.codePointAt(i);
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
  return server;
}

export async function runAgent(
  cwd: string,
  task?: string,
  cliOverrides?: any,
  multi?: boolean,
): Promise<void> {
  const config = ConfigLoader.loadSync(cwd, cliOverrides);

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
  const autocompleteServer = config.autocomplete?.enabled
    ? startAutocompleteServer(cwd, config)
    : null;

  const tui = new FullscreenTui(cwd, config.models.default, version, config);
  currentTui = tui;
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
      tui.setCost(
        payload.sessionCost,
        payload.totalInputTokens,
        payload.totalCacheReadTokens,
        payload.totalOutputTokens,
      );
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

  const normCwd = resolve(cwd).toLowerCase().replace(/\\/g, "/");
  const normHome = resolve(homedir()).toLowerCase().replace(/\\/g, "/");
  const isHomeOrRoot =
    normCwd === normHome ||
    normCwd === "/" ||
    /^[a-zA-Z]:\/$/.test(normCwd) ||
    dirname(normCwd) === normCwd;

  let watcher: any = null;
  if (!isHomeOrRoot) {
    const indexer = new SymbolIndexer(cwd);
    watcher = watch(cwd, { recursive: true }, (eventType, filename) => {
      if (
        filename &&
        /\.(ts|tsx|js|jsx)$/.test(filename) &&
        !filename.includes(".orbit")
      ) {
        const normalized = filename.replace(/\\/g, "/");
        const isIgnored = ignoreRegexes.some((rx: RegExp) =>
          rx.test(normalized),
        );
        if (isIgnored) return;

        if (watchTimeout) clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
          indexer.index().catch(() => {});
        }, 500); // debounce 500ms
      }
    });
  }

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

      let trimmed = input.trim();
      if (!trimmed) continue;

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

      if (trimmed.startsWith("!") || trimmed.startsWith("/run")) {
        const wasActive = useFullscreenTui && tui.isActive;
        if (wasActive) tui.stop();

        let shellCmd = "";
        if (trimmed.startsWith("!")) {
          shellCmd = trimmed.substring(1).trim();
        } else {
          shellCmd = trimmed.substring(4).trim();
        }

        const isZh = config.language === "zh";
        if (!shellCmd) {
          console.log(
            isZh
              ? picocolors.yellow(
                  "用法: !<shell_command> 或 /run <shell_command>",
                )
              : picocolors.yellow(
                  "Usage: !<shell_command> or /run <shell_command>",
                ),
          );
          if (wasActive) tui.start(config.budgetLimit);
          continue;
        }

        const permissionEngine = new PermissionEngine(config);
        const decision = permissionEngine.evaluate(
          "bash",
          { command: shellCmd },
          "execute",
        );
        if (decision.action === "deny") {
          console.log(
            picocolors.red(
              isZh
                ? `✖ 命令已被安全策略阻止: ${decision.reason}`
                : `✖ Command blocked by safety policy: ${decision.reason}`,
            ),
          );
          if (wasActive) tui.start(config.budgetLimit);
          continue;
        }
        if (decision.action === "ask") {
          const approved = await Prompt.askApproval(
            isZh
              ? `命令需要 ${decision.risk} 权限：${shellCmd}`
              : `Command requires ${decision.risk} permission: ${shellCmd}`,
          );
          if (!approved) {
            console.log(
              picocolors.yellow(
                isZh ? "已取消命令执行。" : "Command execution cancelled.",
              ),
            );
            if (wasActive) tui.start(config.budgetLimit);
            continue;
          }
        }

        console.log(
          isZh
            ? picocolors.cyan(`\n正在执行 Shell 命令: ${shellCmd}...`)
            : picocolors.cyan(`\nRunning shell command: ${shellCmd}...`),
        );

        try {
          const { spawnSync } = await import("child_process");
          const result = spawnSync(shellCmd, {
            cwd,
            stdio: "inherit",
            shell: true,
          });

          if (result.status === 0) {
            console.log(
              isZh
                ? picocolors.green(`\n✔ 命令执行成功。`)
                : picocolors.green(`\n✔ Command completed successfully.`),
            );
          } else {
            console.log(
              isZh
                ? picocolors.red(`\n✖ 命令执行失败，退出代码: ${result.status}`)
                : picocolors.red(
                    `\n✖ Command failed with exit code ${result.status}`,
                  ),
            );
          }

          await Prompt.askText(
            isZh
              ? "按 Enter 键返回 Orbit..."
              : "Press Enter to return to Orbit...",
          );
        } catch (err: any) {
          console.log(
            isZh
              ? picocolors.red(`无法执行命令: ${err.message}`)
              : picocolors.red(`Failed to execute command: ${err.message}`),
          );
        } finally {
          tui.syncFromLoop(loop);
          if (wasActive) tui.start(config.budgetLimit);
        }
        continue;
      }

      if (trimmed.startsWith("/")) {
        const parts = trimmed.split(" ");
        const command = parts[0].toLowerCase();

        if (command === "/exit" || command === "/quit") {
          console.log(
            picocolors.yellow("Exiting Orbit Interactive Shell. Goodbye!"),
          );
          break;
        }

        if (command === "/help") {
          const helpText = [
            "",
            "Available Slash Commands:",
            "  /help           - Show this help message",
            "  /status         - Display session provider, active model, cost, and budget",
            "  /config [k=v]   - View or modify configurations interactively or via key=value",
            "  /model [name]   - Get or set the active model dynamically",
            "  /chat [sub]     - Manage/switch sessions (subcommands: list/ls, new, delete/rm, switch <id/index>)",
            "  /api            - Configure API keys and Base URLs interactively",
            "  /commit [msg]   - Stage changes and commit them (LLM message generation if empty)",
            "  /exit, /quit    - Terminate the REPL session",
            "  /rollback       - Revert the last file edits checkpoint",
            "  /timeline       - List persistent file checkpoints for this session",
            "  /rewind [id|n]  - Rewind this session to a selected checkpoint",
            "  /clear          - Clear terminal screen",
            "  /compact        - Compact older agent chat history",
            "  /history        - Display command history of this session",
            "  /edit           - Open external editor for long/multiline prompts",
            "  /inspect        - (CodeWhale) Visualize codebase outline and stats",
            "  /doc [file]     - (Codex) Generate TSDoc/JSDoc documentation for a file",
            "  /diagnose       - (AtomCode) Run tests and auto-repair failures",
            "  /resolve [file] - Resolve merge conflicts in a file semantically using LLM",
            "  /references [s] - Find all call sites and usages of symbol s in workspace",
            "  /run <cmd>      - Execute a shell command directly (shortcut: !<cmd>)",
            "  /grep <query>   - Search for string patterns across workspace files and add them",
            "  /fork [name]    - Fork current session with history into a new session",
            "  /fork tree      - Display lineage hierarchy tree of session forks",
            "  /fork switch <id/idx> - Switch focus to specified branch session",
            "  /mode [mode]    - Switch security confirmation mode (strict, normal, auto, plan)",
            "  /ask            - Shortcut for /mode strict (read-only / high security)",
            "  /code           - Shortcut for /mode normal (default editing mode)",
            "  /copy           - Copy the last assistant response to system clipboard",
            "  /copy-context   - Copy active context files list to system clipboard",
            "  /git <args>     - Execute a git command directly in the sandbox",
            "  /tokens         - Report detailed token usage & cost for the session",
            "  /read-only <f>  - Add files to context as read-only references",
            "  /btw <q>        - Ask a quick side-question without polluting history",
            "  /memory         - View workspace memory / AGENTS.md guidelines",
            "  /commands       - List project and user custom prompt commands",
            "",
          ].join("\n");
          printOutput(helpText);
          continue;
        }

        if (command === "/commands") {
          const isZh = config.language === "zh";
          const customCommands = loadCustomCommands(
            cwd,
            BUILTIN_SLASH_COMMANDS,
          );
          if (customCommands.length === 0) {
            printOutput(
              picocolors.yellow(
                isZh
                  ? "未发现自定义命令。可在 .orbit/commands/*.md 或 ~/.orbit/commands/*.md 中创建。"
                  : "No custom commands found. Create them in .orbit/commands/*.md or ~/.orbit/commands/*.md.",
              ),
            );
            continue;
          }
          printOutput(
            [
              picocolors.bold(
                picocolors.cyan(
                  isZh
                    ? "\n=== Orbit 自定义命令 ==="
                    : "\n=== Orbit Custom Commands ===",
                ),
              ),
              ...customCommands.map(
                (customCommand) =>
                  `  /${picocolors.green(customCommand.name)}${customCommand.argumentHint ? ` ${picocolors.dim(customCommand.argumentHint)}` : ""}\n    ${customCommand.description} ${picocolors.dim(`[${customCommand.source}]`)}`,
              ),
              picocolors.cyan("============================\n"),
            ].join("\n"),
          );
          continue;
        }

        if (command === "/api" || command === "/register") {
          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();
          try {
            const restoreTuiAndPrint = (msg: string) => {
              if (wasActive && !tui.isActive) {
                tui.start(config.budgetLimit);
              }
              printOutput(msg);
            };

            const providersList = [
              {
                value: "deepseek-openai",
                label: "DeepSeek (OpenAI compatible)",
              },
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
              restoreTuiAndPrint(
                picocolors.yellow("API configuration cancelled."),
              );
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
              restoreTuiAndPrint(
                picocolors.yellow("API configuration cancelled."),
              );
              continue;
            }

            const apiKey = await Prompt.askPassword(
              `Enter API Key for ${providerKey}:`,
            );
            if (apiKey === null) {
              restoreTuiAndPrint(
                picocolors.yellow("API configuration cancelled."),
              );
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
            const { join: pathJoin, dirname: pathDirname } =
              await import("path");
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
              restoreTuiAndPrint(
                picocolors.green(
                  `✔ Saved provider "${providerKey}" configuration to global config at ${globalConfigPath}`,
                ),
              );
            } catch (err: any) {
              restoreTuiAndPrint(
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
              restoreTuiAndPrint(
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
                  restoreTuiAndPrint(
                    picocolors.green(
                      `✔ Switched session provider to "${providerKey}".`,
                    ),
                  );
                } else {
                  restoreTuiAndPrint(
                    picocolors.red(
                      `Failed to instantiate provider for "${providerKey}".`,
                    ),
                  );
                }
              }
            }
          } finally {
            if (wasActive && !tui.isActive) {
              tui.start(config.budgetLimit);
            }
          }
          continue;
        }

        if (command === "/edit") {
          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();
          try {
            const restoreTuiAndPrint = (msg: string) => {
              if (wasActive && !tui.isActive) {
                tui.start(config.budgetLimit);
              }
              printOutput(msg);
            };

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
              const editor =
                config.editor || process.env.EDITOR || "notepad.exe";
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
                restoreTuiAndPrint(
                  picocolors.yellow("Empty prompt. Aborting."),
                );
                continue;
              }
              restoreTuiAndPrint(
                picocolors.green(
                  `Loaded prompt: "${promptContent.substring(0, 60)}..."`,
                ),
              );

              // Restart TUI before running agent
              if (wasActive && !tui.isActive) {
                tui.start(config.budgetLimit);
              }

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
              restoreTuiAndPrint(
                picocolors.red(`Failed to open editor: ${err.message}`),
              );
            }
          } finally {
            if (wasActive && !tui.isActive) {
              tui.start(config.budgetLimit);
            }
          }
          continue;
        }

        if (command === "/rollback") {
          const isZh = config.language === "zh";
          const args = parts.slice(1).join(" ").trim();

          if (args === "all" || args === "--all") {
            await loop.rollbackLastCheckpoint();
            continue;
          }

          const { execSync } = await import("child_process");
          let statusOut = "";
          try {
            statusOut = execSync("git status --porcelain", {
              cwd,
              stdio: ["ignore", "pipe", "ignore"],
            }).toString();
          } catch {
            await loop.rollbackLastCheckpoint();
            continue;
          }

          const lines = statusOut
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length === 0) {
            console.log(
              isZh
                ? picocolors.yellow(
                    "当前工作区没有检测到任何未提交的代码变更。",
                  )
                : picocolors.yellow(
                    "No uncommitted changes detected in the workspace.",
                  ),
            );
            continue;
          }

          const modifiedFiles = lines.map((line) => {
            const filepath = line
              .substring(3)
              .trim()
              .replace(/^["']|["']$/g, "");
            if (filepath.includes(" -> ")) {
              const parts = filepath.split(" -> ");
              return parts[parts.length - 1].trim().replace(/^["']|["']$/g, "");
            }
            return filepath;
          });

          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();

          try {
            const options = [
              {
                value: "all",
                label: isZh
                  ? "【全部回滚】 撤销所有变更"
                  : "[Rollback All] Discard all changes",
              },
              ...modifiedFiles.map((f) => ({ value: f, label: f })),
            ];

            const selected = await Prompt.askMultiSelect(
              isZh
                ? "选择要回滚（撤销变更）的文件："
                : "Select files to rollback (discard changes):",
              options,
            );

            if (selected && selected.length > 0) {
              if (selected.includes("all")) {
                await loop.rollbackLastCheckpoint();
              } else {
                for (const file of selected) {
                  const rolledBack = (loop as any).rollbackFileToCheckpoint(
                    file,
                  );
                  if (!rolledBack) {
                    try {
                      execSync(`git checkout -- "${file}"`, {
                        cwd,
                        stdio: "ignore",
                      });
                    } catch {
                      try {
                        const fs = await import("fs");
                        const fullP = resolve(cwd, file);
                        if (fs.existsSync(fullP)) {
                          fs.unlinkSync(fullP);
                        }
                      } catch {}
                    }
                  }
                }
                console.log(
                  isZh
                    ? picocolors.green(
                        `✔ 成功回滚以下文件的变更: ${selected.join(", ")}`,
                      )
                    : picocolors.green(
                        `✔ Successfully rolled back changes for: ${selected.join(", ")}`,
                      ),
                );
              }
            } else {
              console.log(
                isZh
                  ? picocolors.yellow("未选择任何文件。")
                  : picocolors.yellow("No files selected."),
              );
            }
          } catch (err: any) {
            console.log(
              isZh
                ? picocolors.red(`回滚操作失败: ${err.message}`)
                : picocolors.red(`Rollback operation failed: ${err.message}`),
            );
          } finally {
            tui.syncFromLoop(loop);
            if (wasActive) tui.start(config.budgetLimit);
          }
          continue;
        }

        if (command === "/timeline") {
          const checkpoints = loop.getCheckpoints();
          const isZh = config.language === "zh";
          if (checkpoints.length === 0) {
            printOutput(
              picocolors.yellow(
                isZh
                  ? "当前会话没有可用检查点。"
                  : "No checkpoints are available for this session.",
              ),
            );
            continue;
          }
          const lines = [
            picocolors.bold(
              picocolors.cyan(
                isZh
                  ? "\n=== Orbit 检查点时间线 ==="
                  : "\n=== Orbit Checkpoint Timeline ===",
              ),
            ),
            ...checkpoints.map((checkpoint, index) => {
              const time = new Date(checkpoint.timestamp).toLocaleString();
              return `${index + 1}. ${picocolors.green(checkpoint.id)}  ${picocolors.gray(time)}\n   ${checkpoint.files.join(", ")}  ${picocolors.dim(checkpoint.toolCallId)}`;
            }),
            picocolors.cyan("================================\n"),
          ];
          printOutput(lines.join("\n"));
          continue;
        }

        if (command === "/rewind") {
          const checkpoints = loop.getCheckpoints();
          const isZh = config.language === "zh";
          if (checkpoints.length === 0) {
            printOutput(
              picocolors.yellow(
                isZh
                  ? "当前会话没有可回退的检查点。"
                  : "No checkpoints are available to rewind.",
              ),
            );
            continue;
          }
          let target = parts.slice(1).join(" ").trim();
          if (!target) {
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();
            const options = [...checkpoints].reverse().map((checkpoint) => ({
              value: checkpoint.id,
              label: `${checkpoint.id} — ${checkpoint.files.join(", ")} — ${new Date(checkpoint.timestamp).toLocaleString()}`,
            }));
            options.push({ value: "cancel", label: isZh ? "取消" : "Cancel" });
            target =
              (await Prompt.askSelect(
                isZh
                  ? "选择要回退到的检查点："
                  : "Select a checkpoint to rewind to:",
                options,
              )) || "cancel";
            if (wasActive) tui.start(config.budgetLimit);
          }
          if (target === "cancel") continue;
          const index = Number(target);
          if (
            Number.isInteger(index) &&
            index >= 1 &&
            index <= checkpoints.length
          ) {
            target = checkpoints[index - 1].id;
          }
          await loop.rewindToCheckpoint(target);
          tui.syncFromLoop(loop);
          continue;
        }

        if (command === "/status") {
          const config = loop.getConfig();
          const provider = loop.getProvider();
          const activeModel = loop.getModelOverride() || config.models.default;
          const budgetLimit = config.budgetLimit;
          const currentCost = loop.getSessionCost();
          const mode = config.permissions.mode;

          const statusText = [
            picocolors.bold(picocolors.cyan("\n=== Orbit Session Status ===")),
            `  🆔 Session ID:   ${picocolors.green(loop.getSessionId())}`,
            `  🔌 Provider:     ${picocolors.green(provider.id)} (${provider.baseUrl || "Default URL"})`,
            `  🤖 Active Model:  ${picocolors.green(activeModel)}`,
            `  💰 Session Cost: $${currentCost.toFixed(4)} / $${budgetLimit.toFixed(2)} (Limit)`,
            `  🛡️ Security Mode: ${picocolors.green(mode.toUpperCase())}`,
            picocolors.cyan("============================\n"),
          ].join("\n");
          printOutput(statusText);
          continue;
        }

        if (command === "/config") {
          const configArg = parts.slice(1).join(" ").trim();
          const activeConfig = loop.getConfig();

          if (configArg) {
            const eqIndex = configArg.indexOf("=");
            if (eqIndex === -1) {
              printOutput(
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
              printOutput(
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
                printOutput(
                  picocolors.red(
                    `Error: Key "${key}" expects a boolean value (true/false).`,
                  ),
                );
                continue;
              }
            } else if (typeof currentVal === "number") {
              const num = Number(rawVal);
              if (isNaN(num)) {
                printOutput(
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
              printOutput(
                picocolors.red(
                  `Configuration validation failed: ${parseResult.error.message}`,
                ),
              );
              continue;
            }

            setNestedProperty(activeConfig, key, parsedVal);
            printOutput(
              picocolors.green(`✔ Updated "${key}" to: ${parsedVal}`),
            );
            continue;
          }

          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();
          try {
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
                      picocolors.green(
                        `✔ Updated "${choice}" to: ${nextValStr}`,
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
              }
            }
          } finally {
            if (wasActive && !tui.isActive) {
              tui.start(config.budgetLimit);
            }
          }
          continue;
        }

        if (command === "/model") {
          const modelArg = parts.slice(1).join(" ").trim();
          const config = loop.getConfig();
          const isZh = config.language === "zh";
          if (!modelArg) {
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();
            try {
              const activeModel =
                loop.getModelOverride() || config.models.default;
              let modelOptions: Array<{ value: string; label: string }> = [];
              const providerId = providerInstance.id;

              if (providerId === "anthropic") {
                modelOptions = [
                  {
                    value: "claude-3-5-sonnet-latest",
                    label:
                      "claude-3-5-sonnet-latest (Claude 3.5 Sonnet - Recommended)",
                  },
                  {
                    value: "claude-3-5-haiku-latest",
                    label: "claude-3-5-haiku-latest (Claude 3.5 Haiku)",
                  },
                  {
                    value: "claude-3-opus-latest",
                    label: "claude-3-opus-latest (Claude 3 Opus)",
                  },
                ];
              } else if (providerId === "openai") {
                modelOptions = [
                  { value: "gpt-4o", label: "gpt-4o (GPT-4o - Recommended)" },
                  { value: "gpt-4o-mini", label: "gpt-4o-mini (GPT-4o mini)" },
                  { value: "o1", label: "o1 (o1 Reasoner)" },
                  {
                    value: "o3-mini",
                    label: "o3-mini (o3-mini Fast Reasoner)",
                  },
                ];
              } else if (
                providerId === "deepseek-openai" ||
                providerId === "deepseek-anthropic"
              ) {
                modelOptions = [
                  {
                    value: "deepseek-v4-flash",
                    label:
                      "deepseek-v4-flash (DeepSeek-V4 / Fast & Flash - Recommended)",
                  },
                  {
                    value: "deepseek-v4-pro",
                    label: "deepseek-v4-pro (DeepSeek-V4 / Advanced & Pro)",
                  },
                  {
                    value: "deepseek-chat",
                    label: "deepseek-chat (DeepSeek-V3 / Chat)",
                  },
                  {
                    value: "deepseek-reasoner",
                    label: "deepseek-reasoner (DeepSeek-R1 / Reasoner)",
                  },
                ];
              } else if (providerId === "ollama") {
                modelOptions = [
                  { value: "qwen2.5-coder:7b", label: "qwen2.5-coder:7b" },
                  { value: "qwen2.5-coder:1.5b", label: "qwen2.5-coder:1.5b" },
                  { value: "llama3", label: "llama3" },
                ];
              } else {
                modelOptions = [
                  {
                    value: "deepseek-v4-flash",
                    label: "deepseek-v4-flash (DeepSeek-V4 / Fast & Flash)",
                  },
                  {
                    value: "deepseek-v4-pro",
                    label: "deepseek-v4-pro (DeepSeek-V4 / Advanced & Pro)",
                  },
                  { value: "gpt-4o", label: "gpt-4o (GPT-4o)" },
                  {
                    value: "claude-3-5-sonnet-latest",
                    label: "claude-3-5-sonnet-latest (Claude 3.5 Sonnet)",
                  },
                ];
              }

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
                  if (wasActive && !tui.isActive) {
                    tui.start(config.budgetLimit);
                  }
                  printOutput(
                    `Switched active model to: ${picocolors.green(customModel)}`,
                  );
                } else {
                  continue;
                }
              } else {
                loop.setModelOverride(selectedModel);
                if (wasActive && !tui.isActive) {
                  tui.start(config.budgetLimit);
                }
                printOutput(
                  `Switched active model to: ${picocolors.green(selectedModel)}`,
                );
              }
              saveLocalState(cwd, { lastModel: finalModel });
            } finally {
              if (wasActive && !tui.isActive) {
                tui.start(config.budgetLimit);
              }
            }
            continue;
          }

          loop.setModelOverride(modelArg);
          printOutput(
            `Switched active model to: ${picocolors.green(modelArg)}`,
          );
          saveLocalState(cwd, { lastModel: modelArg });
          continue;
        }

        if (command === "/commit") {
          const commitMsg = parts.slice(1).join(" ").trim();
          const config = loop.getConfig();
          const isZh = config.language === "zh";
          const { execSync } = await import("child_process");
          try {
            let diff = execSync("git diff --cached", { cwd }).toString().trim();
            if (!diff) {
              const unstaged = execSync("git status --porcelain", { cwd })
                .toString()
                .trim();
              if (!unstaged) {
                console.log(
                  picocolors.yellow(
                    isZh
                      ? "工作区干净，没有检测到任何已暂存或未暂存的更改。"
                      : "Workspace clean. No staged or unstaged changes found to commit.",
                  ),
                );
                continue;
              }

              const wasActive = useFullscreenTui && tui.isActive;
              if (wasActive) tui.stop();

              const autoStage = await Prompt.askApproval(
                isZh
                  ? "未检测到已暂存的修改，是否自动暂存工作区中的所有变更并生成提交？"
                  : "No staged changes found. Automatically stage all local changes and create a commit?",
              );

              if (wasActive) tui.start(config.budgetLimit);

              if (!autoStage) {
                console.log(
                  picocolors.yellow(
                    isZh
                      ? "操作已取消。请先运行 'git add' 暂存你的修改。"
                      : "Operation cancelled. Please run 'git add' to stage your changes first.",
                  ),
                );
                continue;
              }

              console.log(
                isZh ? "正在暂存所有变更..." : "Staging all changes...",
              );
              execSync("git add -A", { cwd });
              diff = execSync("git diff --cached", { cwd }).toString().trim();
              if (!diff) {
                console.log(
                  picocolors.red(
                    isZh
                      ? "✖ 暂存失败或暂存后仍无变更。"
                      : "✖ Staging failed or resulted in no diff.",
                  ),
                );
                continue;
              }
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

        if (command === "/diff") {
          try {
            const { execSync } = await import("child_process");
            const diffOutput = execSync("git diff --color", {
              cwd,
              stdio: ["ignore", "pipe", "ignore"],
            }).toString();
            if (!diffOutput.trim()) {
              const isZh = config.language === "zh";
              console.log(
                isZh
                  ? picocolors.yellow("\n工作区未检测到任何代码变更。")
                  : picocolors.yellow("\nNo changes detected in workspace."),
              );
            } else {
              const wasActive = useFullscreenTui && tui.isActive;
              if (wasActive) tui.stop();

              await pageText(diffOutput);

              if (wasActive) tui.start(config.budgetLimit);
            }
          } catch (err: any) {
            const isZh = config.language === "zh";
            console.log(
              isZh
                ? picocolors.red(`生成 Git 差异比对失败: ${err.message}`)
                : picocolors.red(`Failed to generate git diff: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/test") {
          let testCmd = "";
          const projectIndex = (loop as any).cachedContextPack?.projectIndex;
          if (
            projectIndex?.testCommands &&
            projectIndex.testCommands.length > 0
          ) {
            testCmd = projectIndex.testCommands[0];
          }

          if (!testCmd) {
            const pkgPath = join(cwd, "package.json");
            if (existsSync(pkgPath)) {
              try {
                const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
                if (
                  pkg.scripts &&
                  pkg.scripts.test &&
                  pkg.scripts.test !==
                    'echo "Error: no test specified" && exit 1'
                ) {
                  testCmd = "npm test";
                }
              } catch {}
            }
          }

          if (!testCmd) {
            testCmd = "npm test";
          }

          const isZh = config.language === "zh";
          console.log(
            isZh
              ? picocolors.cyan(`\n正在执行单元测试，指令: ${testCmd}...`)
              : picocolors.cyan(`\nRunning tests via: ${testCmd}...`),
          );
          try {
            const { spawn } = await import("child_process");
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();

            await new Promise<void>((resolve) => {
              const parts = testCmd.split(/\s+/);
              const child = spawn(parts[0], parts.slice(1), {
                cwd,
                stdio: "inherit",
                shell: true,
              });
              child.on("close", (code) => {
                if (code === 0) {
                  console.log(
                    isZh
                      ? picocolors.green(`\n✔ 测试顺利通过。`)
                      : picocolors.green(`\n✔ Tests completed successfully.`),
                  );
                } else {
                  console.log(
                    isZh
                      ? picocolors.red(`\n✖ 测试执行失败，退出代码: ${code}`)
                      : picocolors.red(
                          `\n✖ Tests failed with exit code ${code}`,
                        ),
                  );
                }
                resolve();
              });
              child.on("error", (err) => {
                console.log(
                  isZh
                    ? picocolors.red(`\n✖ 无法启动测试程序: ${err.message}`)
                    : picocolors.red(
                        `\n✖ Failed to start tests: ${err.message}`,
                      ),
                );
                resolve();
              });
            });

            if (wasActive) tui.start(config.budgetLimit);
          } catch (err: any) {
            console.log(
              isZh
                ? picocolors.red(`执行测试失败: ${err.message}`)
                : picocolors.red(`Failed to execute tests: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/add") {
          const fileArg = parts.slice(1).join(" ").trim();
          const isZh = config.language === "zh";
          if (!fileArg) {
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();

            try {
              if (
                !candidates ||
                !candidates.files ||
                candidates.files.length === 0
              ) {
                console.log(
                  isZh
                    ? picocolors.yellow("工作区未找到可添加的文件。")
                    : picocolors.yellow(
                        "No files found in the workspace to add.",
                      ),
                );
              } else {
                const filterQuery = await Prompt.askText(
                  isZh
                    ? "输入文件名过滤词（支持模糊匹配，直接回车列出所有）："
                    : "Enter filename filter query (fuzzy, press Enter for all):",
                );

                if (filterQuery === null) {
                  console.log(
                    isZh
                      ? picocolors.yellow("操作已取消。")
                      : picocolors.yellow("Operation cancelled."),
                  );
                  continue;
                }

                let filtered = candidates.files;
                if (filterQuery.trim()) {
                  const q = filterQuery.trim().toLowerCase();
                  filtered = candidates.files.filter((f) =>
                    f.toLowerCase().includes(q),
                  );
                }

                if (filtered.length === 0) {
                  console.log(
                    isZh
                      ? picocolors.yellow("未找到匹配过滤词的文件。")
                      : picocolors.yellow("No matching files found."),
                  );
                } else {
                  const options = filtered.map((f) => ({ value: f, label: f }));
                  const selected = await Prompt.askMultiSelect(
                    isZh
                      ? "选择要添加到上下文的文件："
                      : "Select files to add to the context:",
                    options,
                  );
                  if (selected && selected.length > 0) {
                    for (const f of selected) {
                      loop.addRelevantFilePublic(
                        f,
                        "Manually added via interactive /add",
                      );
                    }
                    console.log(
                      isZh
                        ? picocolors.green(
                            `✔ 成功添加 ${selected.length} 个文件到上下文。`,
                          )
                        : picocolors.green(
                            `✔ Added ${selected.length} file(s) to active context.`,
                          ),
                    );
                  } else {
                    console.log(
                      isZh
                        ? picocolors.yellow("未选择任何文件。")
                        : picocolors.yellow("No files selected."),
                    );
                  }
                }
              }
            } catch (err: any) {
              console.log(
                isZh
                  ? picocolors.red(`选择文件失败: ${err.message}`)
                  : picocolors.red(`Failed to select files: ${err.message}`),
              );
            } finally {
              tui.syncFromLoop(loop);
              if (wasActive) tui.start(config.budgetLimit);
            }
            continue;
          }

          const { isAbsolute, relative, resolve } = await import("path");
          const { statSync } = await import("fs");
          const absPath = isAbsolute(fileArg) ? fileArg : resolve(cwd, fileArg);
          const relPath = relative(cwd, absPath).replace(/\\/g, "/");

          if (!existsSync(absPath)) {
            const matched = (candidates?.files || []).filter(
              (f) =>
                f.toLowerCase().includes(fileArg.toLowerCase()) ||
                f.toLowerCase().endsWith("/" + fileArg.toLowerCase()),
            );
            if (matched.length === 1) {
              loop.addRelevantFilePublic(matched[0], "Fuzzy matched via /add");
              console.log(
                isZh
                  ? picocolors.green(`✔ 自动匹配并添加文件: ${matched[0]}`)
                  : picocolors.green(
                      `✔ Auto-matched and added file: ${matched[0]}`,
                    ),
              );
              tui.syncFromLoop(loop);
              continue;
            } else if (matched.length > 1) {
              console.log(
                isZh
                  ? picocolors.yellow(
                      `找到多个匹配文件，请精确输入路径或使用无参交互选择:\n${matched.map((m) => `  • ${m}`).join("\n")}`,
                    )
                  : picocolors.yellow(
                      `Multiple matches found, please specify or use interactive select:\n${matched.map((m) => `  • ${m}`).join("\n")}`,
                    ),
              );
              continue;
            }
            console.log(
              isZh
                ? picocolors.red(`文件不存在: ${fileArg}`)
                : picocolors.red(`File does not exist: ${fileArg}`),
            );
            continue;
          }

          try {
            const stat = statSync(absPath);
            if (stat.isDirectory()) {
              const files = await glob("**/*", {
                cwd: absPath,
                onlyFiles: true,
                suppressErrors: true,
              });
              for (const f of files) {
                const subRelPath = join(relPath, f).replace(/\\/g, "/");
                loop.addRelevantFilePublic(
                  subRelPath,
                  "Manually added directory via /add",
                );
              }
              console.log(
                isZh
                  ? picocolors.green(
                      `✔ 成功添加目录 ${relPath} 下的所有文件到上下文。`,
                    )
                  : picocolors.green(
                      `✔ Added all files in directory ${relPath} to active context.`,
                    ),
              );
            } else {
              loop.addRelevantFilePublic(
                relPath,
                "Manually added file via /add",
              );
              console.log(
                isZh
                  ? picocolors.green(`✔ 已将 ${relPath} 添加到上下文。`)
                  : picocolors.green(`✔ Added ${relPath} to active context.`),
              );
            }
            tui.syncFromLoop(loop);
          } catch (err: any) {
            console.log(
              isZh
                ? picocolors.red(`添加失败: ${err.message}`)
                : picocolors.red(`Failed to add: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/read-only" || command === "/readonly") {
          const fileArg = parts.slice(1).join(" ").trim();
          const isZh = config.language === "zh";
          if (!fileArg) {
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();

            try {
              if (
                !candidates ||
                !candidates.files ||
                candidates.files.length === 0
              ) {
                console.log(
                  isZh
                    ? picocolors.yellow("工作区未找到可添加的文件。")
                    : picocolors.yellow(
                        "No files found in the workspace to add.",
                      ),
                );
              } else {
                const filterQuery = await Prompt.askText(
                  isZh
                    ? "输入文件名过滤词（支持模糊匹配，直接回车列出所有）："
                    : "Enter filename filter query (fuzzy, press Enter for all):",
                );

                if (filterQuery === null) {
                  console.log(
                    isZh
                      ? picocolors.yellow("操作已取消。")
                      : picocolors.yellow("Operation cancelled."),
                  );
                  continue;
                }

                let filtered = candidates.files;
                if (filterQuery.trim()) {
                  const q = filterQuery.trim().toLowerCase();
                  filtered = candidates.files.filter((f) =>
                    f.toLowerCase().includes(q),
                  );
                }

                if (filtered.length === 0) {
                  console.log(
                    isZh
                      ? picocolors.yellow("未找到匹配过滤词的文件。")
                      : picocolors.yellow("No matching files found."),
                  );
                } else {
                  const options = filtered.map((f) => ({ value: f, label: f }));
                  const selected = await Prompt.askMultiSelect(
                    isZh
                      ? "选择要添加到上下文的只读参考文件："
                      : "Select files to add as read-only reference context:",
                    options,
                  );
                  if (selected && selected.length > 0) {
                    for (const f of selected) {
                      loop.addReadOnlyFilePublic(
                        f,
                        "Manually added via interactive /read-only",
                      );
                    }
                    console.log(
                      isZh
                        ? picocolors.green(
                            `✔ 成功添加 ${selected.length} 个只读文件到上下文。`,
                          )
                        : picocolors.green(
                            `✔ Added ${selected.length} read-only file(s) to active context.`,
                          ),
                    );
                  } else {
                    console.log(
                      isZh
                        ? picocolors.yellow("未选择任何文件。")
                        : picocolors.yellow("No files selected."),
                    );
                  }
                }
              }
            } catch (err: any) {
              console.log(
                isZh
                  ? picocolors.red(`选择文件失败: ${err.message}`)
                  : picocolors.red(`Failed to select files: ${err.message}`),
              );
            } finally {
              tui.syncFromLoop(loop);
              if (wasActive) tui.start(config.budgetLimit);
            }
            continue;
          }

          const { isAbsolute, relative, resolve } = await import("path");
          const { statSync } = await import("fs");
          const absPath = isAbsolute(fileArg) ? fileArg : resolve(cwd, fileArg);
          const relPath = relative(cwd, absPath).replace(/\\/g, "/");

          if (!existsSync(absPath)) {
            const matched = (candidates?.files || []).filter(
              (f) =>
                f.toLowerCase().includes(fileArg.toLowerCase()) ||
                f.toLowerCase().endsWith("/" + fileArg.toLowerCase()),
            );
            if (matched.length === 1) {
              loop.addReadOnlyFilePublic(
                matched[0],
                "Fuzzy matched via /read-only",
              );
              console.log(
                isZh
                  ? picocolors.green(
                      `✔ 自动匹配并添加只读参考文件: ${matched[0]}`,
                    )
                  : picocolors.green(
                      `✔ Auto-matched and added read-only reference: ${matched[0]}`,
                    ),
              );
              tui.syncFromLoop(loop);
              continue;
            } else if (matched.length > 1) {
              console.log(
                isZh
                  ? picocolors.yellow(
                      `找到多个匹配文件，请精确输入路径或使用无参交互选择:\n${matched.map((m) => `  • ${m}`).join("\n")}`,
                    )
                  : picocolors.yellow(
                      `Multiple matches found, please specify or use interactive select:\n${matched.map((m) => `  • ${m}`).join("\n")}`,
                    ),
              );
              continue;
            }
            console.log(
              isZh
                ? picocolors.red(`文件不存在: ${fileArg}`)
                : picocolors.red(`File does not exist: ${fileArg}`),
            );
            continue;
          }

          try {
            const stat = statSync(absPath);
            if (stat.isDirectory()) {
              const files = await glob("**/*", {
                cwd: absPath,
                onlyFiles: true,
                suppressErrors: true,
              });
              for (const f of files) {
                const subRelPath = join(relPath, f).replace(/\\/g, "/");
                loop.addReadOnlyFilePublic(
                  subRelPath,
                  "Manually added directory via /read-only",
                );
              }
              console.log(
                isZh
                  ? picocolors.green(
                      `✔ 成功添加目录 ${relPath} 下的所有只读文件。`,
                    )
                  : picocolors.green(
                      `✔ Added all files in directory ${relPath} as read-only references.`,
                    ),
              );
            } else {
              loop.addReadOnlyFilePublic(
                relPath,
                "Manually added file via /read-only",
              );
              console.log(
                isZh
                  ? picocolors.green(`✔ 已将只读文件 ${relPath} 添加到上下文。`)
                  : picocolors.green(
                      `✔ Added read-only reference ${relPath} to active context.`,
                    ),
              );
            }
            tui.syncFromLoop(loop);
          } catch (err: any) {
            console.log(
              isZh
                ? picocolors.red(`添加失败: ${err.message}`)
                : picocolors.red(`Failed to add: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/drop") {
          const fileArg = parts.slice(1).join(" ").trim();
          const isZh = config.language === "zh";
          if (!fileArg) {
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();

            try {
              const activeFiles = loop.getRelevantFiles();
              if (activeFiles.length === 0) {
                console.log(
                  isZh
                    ? picocolors.yellow("当前活动上下文为空，无可移除的文件。")
                    : picocolors.yellow(
                        "Active context is empty, no files to remove.",
                      ),
                );
              } else {
                const options = activeFiles.map((f) => ({
                  value: f.path,
                  label: f.path,
                }));
                const selected = await Prompt.askMultiSelect(
                  isZh
                    ? "选择要从上下文中移除的文件："
                    : "Select files to remove from the context:",
                  options,
                );
                if (selected && selected.length > 0) {
                  for (const f of selected) {
                    loop.removeRelevantFilePublic(f);
                  }
                  console.log(
                    isZh
                      ? picocolors.green(
                          `✔ 成功从上下文中移除 ${selected.length} 个文件。`,
                        )
                      : picocolors.green(
                          `✔ Removed ${selected.length} file(s) from active context.`,
                        ),
                  );
                } else {
                  console.log(
                    isZh
                      ? picocolors.yellow("未选择任何文件。")
                      : picocolors.yellow("No files selected."),
                  );
                }
              }
            } catch (err: any) {
              console.log(
                isZh
                  ? picocolors.red(`移除文件失败: ${err.message}`)
                  : picocolors.red(`Failed to remove files: ${err.message}`),
              );
            } finally {
              tui.syncFromLoop(loop);
              if (wasActive) tui.start(config.budgetLimit);
            }
            continue;
          }

          if (fileArg === "all" || fileArg === "*") {
            loop.clearRelevantFilesPublic();
            tui.syncFromLoop(loop);
            console.log(
              isZh
                ? picocolors.green(`✔ 已从上下文中清空所有文件。`)
                : picocolors.green(`✔ Cleared all files from active context.`),
            );
            continue;
          }

          const { isAbsolute, relative, resolve } = await import("path");
          const absPath = isAbsolute(fileArg) ? fileArg : resolve(cwd, fileArg);
          const relPath = relative(cwd, absPath).replace(/\\/g, "/");

          const beforeCount = loop.getRelevantFiles().length;
          loop.removeRelevantFilePublic(relPath);

          // Glob/regex fallback for dropping files by pattern
          const activeFiles = loop.getRelevantFiles().map((f) => f.path);
          const escaped = fileArg.replace(/[.+^${}()|[\]\\]/g, "\\$&");
          const globRegexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
          const rx = new RegExp("^" + globRegexStr + "$", "i");

          for (const f of activeFiles) {
            if (rx.test(f) || f.startsWith(relPath)) {
              loop.removeRelevantFilePublic(f);
            }
          }

          tui.syncFromLoop(loop);
          const afterCount = loop.getRelevantFiles().length;
          const droppedCount = beforeCount - afterCount;
          if (droppedCount > 0) {
            console.log(
              isZh
                ? picocolors.green(
                    `✔ 从上下文中成功移除 ${droppedCount} 个文件。`,
                  )
                : picocolors.green(
                    `✔ Removed ${droppedCount} file(s) from active context.`,
                  ),
            );
          } else {
            console.log(
              isZh
                ? picocolors.yellow(`上下文中未找到匹配 "${fileArg}" 的文件。`)
                : picocolors.yellow(
                    `No files matching "${fileArg}" were found in active context.`,
                  ),
            );
          }
          continue;
        }

        if (command === "/context") {
          const files = loop.getRelevantFiles();
          const isZh = config.language === "zh";
          if (files.length === 0) {
            console.log(
              isZh
                ? picocolors.yellow(
                    "当前活动上下文为空。可使用 /add <file> 添加文件。",
                  )
                : picocolors.yellow(
                    "No files in the active context. Use /add <file> to add files.",
                  ),
            );
          } else {
            console.log(
              isZh
                ? picocolors.bold(
                    picocolors.cyan("\n--- 当前活动上下文文件 ---"),
                  )
                : picocolors.bold(
                    picocolors.cyan("\n--- Active Context Files ---"),
                  ),
            );

            let totalEstimatedTokens = 0;
            const fileTokensList: {
              path: string;
              reason: string;
              tokens: number;
              sizeBytes: number;
              readOnly?: boolean;
            }[] = [];
            const fs = await import("fs");

            for (const f of files) {
              let tokens = 0;
              let sizeBytes = 0;
              try {
                const fullPath = resolveSafePath(cwd, f.path);
                if (fs.existsSync(fullPath)) {
                  const stat = fs.statSync(fullPath);
                  if (stat.isFile()) {
                    sizeBytes = stat.size;
                    const content = fs.readFileSync(fullPath, "utf8");
                    // Simple heuristic: 1 token ~ 4 characters
                    tokens = Math.ceil(content.length / 4);
                  }
                }
              } catch (err) {
                // Ignore file read issues
              }

              totalEstimatedTokens += tokens;
              fileTokensList.push({
                path: f.path,
                reason: f.reason,
                tokens,
                sizeBytes,
                readOnly: (f as any).readOnly,
              });
            }

            for (const f of fileTokensList) {
              const sizeStr =
                f.sizeBytes > 1024
                  ? `${(f.sizeBytes / 1024).toFixed(1)} KB`
                  : `${f.sizeBytes} B`;
              const roLabel = (f as any).readOnly
                ? picocolors.yellow(" [RO]")
                : "";
              console.log(
                `${picocolors.green("•")} ${picocolors.white(f.path)}${roLabel} ${picocolors.gray(`(${f.reason})`)} - ${picocolors.cyan(`~${f.tokens} tokens`)} (${sizeStr})`,
              );
            }

            // Visual Progress Bar (assuming 128k context budget for reference, or customize based on model)
            const contextBudget = 128000;
            const percentage = Math.min(
              100,
              Math.ceil((totalEstimatedTokens / contextBudget) * 100),
            );
            const barWidth = 30;
            const filledWidth = Math.ceil((percentage / 100) * barWidth);
            const emptyWidth = barWidth - filledWidth;
            const progressBar = `[${"█".repeat(filledWidth)}${"░".repeat(emptyWidth)}]`;

            console.log(
              isZh
                ? `\n📊 上下文容量使用率: ${picocolors.yellow(`${percentage}%`)} ${progressBar} (预估: ${totalEstimatedTokens} / ${contextBudget} tokens)`
                : `\n📊 Context Utilization: ${picocolors.yellow(`${percentage}%`)} ${progressBar} (Estimated: ${totalEstimatedTokens} / ${contextBudget} tokens)`,
            );

            // Warnings / Suggestions
            const largeFiles = fileTokensList.filter(
              (f) => f.sizeBytes > 50 * 1024,
            );
            if (largeFiles.length > 0) {
              console.log(
                picocolors.yellow(
                  isZh ? "\n⚠️ 优化建议:" : "\n⚠️ Optimization Suggestions:",
                ),
              );
              for (const f of largeFiles) {
                console.log(
                  isZh
                    ? `  - 文件 ${picocolors.red(f.path)} 体积过大 (>${(f.sizeBytes / 1024).toFixed(1)} KB)，可能会占用大量 Prompt Token，建议使用 /drop 移除或只添加相关部分。`
                    : `  - File ${picocolors.red(f.path)} is abnormally large (>${(f.sizeBytes / 1024).toFixed(1)} KB), which may exhaust prompt tokens. Consider using /drop to remove it.`,
                );
              }
            }
            console.log("");
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
            let partitionIdx = history.length - 10;
            while (partitionIdx > 1) {
              const msg = history[partitionIdx];
              if (msg.role === "tool") {
                partitionIdx--;
                continue;
              }
              const prevMsg = history[partitionIdx - 1];
              const hasToolCalls = prevMsg.content.some(
                (c: any) => c.type === "tool_call",
              );
              if (prevMsg.role === "assistant" && hasToolCalls) {
                partitionIdx--;
                continue;
              }
              break;
            }
            const discarded = history.slice(1, partitionIdx);
            const recentMsgs = history.slice(partitionIdx);

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
              "\n=== Orbit Session Complete Dialogue History ===\n\n",
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
            "================================================\n",
          );

          const wasActive = useFullscreenTui;
          if (wasActive) tui.stop();
          await pageText(fullHistoryText);
          if (wasActive) tui.start(config.budgetLimit);
          continue;
        }

        if (command === "/inspect") {
          const indexPath = join(cwd, ".orbit", "symbols.json");
          if (!existsSync(indexPath)) {
            printOutput(
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
              const outlineLines: string[] = [];
              outlineLines.push(
                picocolors.bold(
                  picocolors.cyan(
                    "\n=== CodeWhale Codebase Visual Outline ===",
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
                  outlineLines.push(
                    `  📄 ${picocolors.bold(picocolors.blue(file))}`,
                  );
                  for (const sym of data.symbols) {
                    totalSymbols++;
                    const symbolColor =
                      sym.type === "class"
                        ? picocolors.magenta
                        : picocolors.green;
                    outlineLines.push(
                      `     • ${symbolColor(sym.name)} (${picocolors.gray(sym.type)})`,
                    );
                  }
                }
              }

              const tsRatio =
                totalFiles > 0
                  ? ((tsFiles / totalFiles) * 100).toFixed(1)
                  : "0.0";
              outlineLines.push(
                picocolors.gray("========================================="),
              );
              outlineLines.push(`  ${picocolors.bold("Codebase Stats:")}`);
              outlineLines.push(
                `    • Total Indexed Files: ${picocolors.green(totalFiles)}`,
              );
              outlineLines.push(
                `    • TypeScript Ratio   : ${picocolors.yellow(tsRatio + "%")}`,
              );
              outlineLines.push(
                `    • Exported Symbols   : ${picocolors.magenta(totalSymbols)}`,
              );
              outlineLines.push(
                picocolors.cyan("=========================================\n"),
              );

              const wasActive = useFullscreenTui;
              if (wasActive) tui.stop();
              await pageText(outlineLines.join("\n"));
              if (wasActive) tui.start(config.budgetLimit);
            }
          } catch (err: any) {
            printOutput(
              picocolors.red(`Failed to parse symbol index: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/doc") {
          const fileArg = parts.slice(1).join(" ").trim();
          if (!fileArg) {
            printOutput(picocolors.yellow("Usage: /doc <file_path>"));
            continue;
          }

          let targetFilePath: string;
          try {
            targetFilePath = resolveSafePath(cwd, fileArg);
          } catch (err: any) {
            printOutput(picocolors.red(`Error: ${err.message}`));
            continue;
          }
          if (!existsSync(targetFilePath)) {
            printOutput(picocolors.red(`Error: File not found: ${fileArg}`));
            continue;
          }

          printOutput(
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
              printOutput(
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
            printOutput(
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
          printOutput(
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
            printOutput(
              picocolors.green(
                `✔ All tests passed successfully! No diagnostics needed.`,
              ),
            );
            continue;
          }

          printOutput(
            picocolors.red(`✖ Tests failed! Outputting diagnostics...`),
          );
          printOutput(picocolors.gray(testResult.stdout || testResult.stderr));

          const repairPrompt = `The test command "${testCommand}" failed. The output log is:\n\n${testResult.stdout || testResult.stderr}\n\nPlease analyze the failure logs, locate the files causing assertion or syntax errors, and fix the codebase so that the test suite passes successfully.`;

          const confirmRepair = await Prompt.askApproval(
            "Launch Agent Loop to auto-repair the test failures?",
          );
          if (!confirmRepair) {
            printOutput(picocolors.yellow("Diagnostics aborted."));
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
          const wasActive = useFullscreenTui && tui.isActive;
          let stoppedTui = false;
          const stopTuiIfNeeded = () => {
            if (wasActive && !stoppedTui) {
              tui.stop();
              stoppedTui = true;
            }
          };
          const restoreTuiAndPrint = (msg: string) => {
            if (wasActive && stoppedTui && !tui.isActive) {
              tui.start(config.budgetLimit);
              stoppedTui = false;
            }
            printOutput(msg);
          };

          try {
            const subCommand = parts[1]?.toLowerCase();
            const arg = parts.slice(2).join(" ").trim();

            const sessions = loop.getSessions();

            // Function to delete session and adjust active session if needed
            const handleDelete = (idToDelete: string) => {
              loop.deleteSession(idToDelete);
              restoreTuiAndPrint(
                picocolors.green(
                  `✔ Session ${idToDelete} deleted successfully.`,
                ),
              );

              // If deleted the current session, switch to the most recent one remaining, or a new one
              const activeSession =
                (loop as any).state?.sessionId ||
                (loop as any).sessionManager.getActiveSession()?.id;
              if (activeSession === idToDelete) {
                const remaining = loop.getSessions();
                if (remaining.length > 0) {
                  const targetSession = remaining[0];
                  const success = loop.resumeSession(targetSession.id);
                  if (success) {
                    tui.loadHistory(loop.getHistory());
                    restoreTuiAndPrint(
                      picocolors.green(
                        `✔ Automatically switched to session: ${targetSession.id}`,
                      ),
                    );
                    saveLocalState(cwd, {
                      lastSessionId: targetSession.id,
                      lastModel:
                        loop.getModelOverride() || config.models.default,
                    });
                  }
                } else {
                  // No sessions left, start a new one
                  const activeModel =
                    loop.getModelOverride() || config.models.default;
                  const newSessionId = loop.startNewSession(
                    providerInstance.id,
                    activeModel,
                  );
                  tui.loadHistory([]);
                  restoreTuiAndPrint(
                    picocolors.green(
                      `✔ Automatically started new session: ${newSessionId}`,
                    ),
                  );
                  saveLocalState(cwd, {
                    lastSessionId: newSessionId,
                    lastModel: activeModel,
                  });
                }
              }
            };

            // CLI subcommand: /chat list / ls
            if (subCommand === "list" || subCommand === "ls") {
              if (sessions.length === 0) {
                restoreTuiAndPrint(
                  picocolors.yellow("No active or saved sessions found."),
                );
              } else {
                let listMsg = picocolors.bold(
                  picocolors.cyan("\n=== Orbit Saved Sessions ===\n\n"),
                );
                const activeSessionId =
                  (loop as any).state?.sessionId ||
                  (loop as any).sessionManager.getActiveSession()?.id;
                sessions.forEach((s: any, idx: number) => {
                  const formattedDate = new Date(s.createdAt).toLocaleString();
                  const isActive = s.id === activeSessionId;
                  const prefixStr = isActive
                    ? picocolors.green("● (active)")
                    : " ";
                  listMsg += `  ${prefixStr} [${idx + 1}] ${picocolors.blue(s.id)} - ${s.title || "Untitled"} (${formattedDate}) [${s.model}]\n`;
                });
                listMsg += picocolors.cyan("============================\n");
                restoreTuiAndPrint(listMsg);
              }
              continue;
            }

            // CLI subcommand: /chat delete / rm / del
            if (
              subCommand === "delete" ||
              subCommand === "rm" ||
              subCommand === "del"
            ) {
              let idToDelete = arg;
              if (!idToDelete) {
                if (sessions.length === 0) {
                  restoreTuiAndPrint(
                    picocolors.yellow(
                      "No active or saved sessions found to delete.",
                    ),
                  );
                  continue;
                }
                const deleteOptions = sessions.map((s: any) => {
                  const formattedDate = new Date(s.createdAt).toLocaleString();
                  return {
                    value: s.id,
                    label: `${s.id} - ${s.title || "Untitled"} (${formattedDate}) [${s.model}]`,
                  };
                });
                deleteOptions.push({
                  value: "cancel",
                  label: "Cancel",
                });
                stopTuiIfNeeded();
                idToDelete = await Prompt.askSelect(
                  "Choose a session to delete:",
                  deleteOptions,
                );
              } else {
                // Check if index was provided instead of full id
                const idx = parseInt(idToDelete, 10);
                if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
                  idToDelete = sessions[idx - 1].id;
                } else {
                  // check if it's a valid session ID
                  const found = sessions.find((s: any) => s.id === idToDelete);
                  if (!found) {
                    restoreTuiAndPrint(
                      picocolors.red(`✖ Session not found: ${idToDelete}`),
                    );
                    continue;
                  }
                }
              }

              if (!idToDelete || idToDelete === "cancel") {
                continue;
              }

              // confirm deletion only if no arg was specified
              let confirm = "yes";
              if (!arg) {
                stopTuiIfNeeded();
                confirm = await Prompt.askSelect(
                  `Are you sure you want to delete session ${idToDelete}?`,
                  [
                    { value: "yes", label: "Yes, delete it" },
                    { value: "no", label: "No, cancel" },
                  ],
                );
              }

              if (confirm === "yes") {
                handleDelete(idToDelete);
              }
              continue;
            }

            // CLI subcommand: /chat new / create
            if (subCommand === "new" || subCommand === "create") {
              const activeModel =
                loop.getModelOverride() || config.models.default;
              const newSessionId = loop.startNewSession(
                providerInstance.id,
                activeModel,
              );
              tui.loadHistory([]);
              restoreTuiAndPrint(
                picocolors.green(`✔ Started new session: ${newSessionId}`),
              );

              saveLocalState(cwd, {
                lastSessionId: newSessionId,
                lastModel: activeModel,
              });
              continue;
            }

            // CLI subcommand: /chat switch / load
            if (
              subCommand === "switch" ||
              subCommand === "load" ||
              (subCommand &&
                (sessions.some((s: any) => s.id === subCommand) ||
                  !isNaN(parseInt(subCommand, 10))))
            ) {
              let targetId =
                subCommand === "switch" || subCommand === "load"
                  ? arg
                  : subCommand;
              if (!targetId) {
                restoreTuiAndPrint(
                  picocolors.yellow("Usage: /chat switch <session_id | index>"),
                );
                continue;
              }
              const idx = parseInt(targetId, 10);
              if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
                targetId = sessions[idx - 1].id;
              }
              const found = sessions.find((s: any) => s.id === targetId);
              if (!found) {
                restoreTuiAndPrint(
                  picocolors.red(`✖ Session not found: ${targetId}`),
                );
                continue;
              }

              const success = loop.resumeSession(targetId);
              if (success) {
                tui.loadHistory(loop.getHistory());
                restoreTuiAndPrint(
                  picocolors.green(`✔ Switched to session: ${targetId}`),
                );

                saveLocalState(cwd, {
                  lastSessionId: targetId,
                  lastModel: loop.getModelOverride() || config.models.default,
                });
              } else {
                restoreTuiAndPrint(
                  picocolors.red(`✖ Failed to resume session: ${targetId}`),
                );
              }
              continue;
            }

            // Fallback: If no subcommands, show the interactive select menu
            if (sessions.length === 0) {
              // start a new session since none exist
              const activeModel =
                loop.getModelOverride() || config.models.default;
              const newSessionId = loop.startNewSession(
                providerInstance.id,
                activeModel,
              );
              tui.loadHistory([]);
              restoreTuiAndPrint(
                picocolors.green(`✔ Started new session: ${newSessionId}`),
              );
              saveLocalState(cwd, {
                lastSessionId: newSessionId,
                lastModel: activeModel,
              });
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
            sessionOptions.unshift({
              value: "delete_menu",
              label: picocolors.red("- Delete a session..."),
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

            if (selectedSessionId === "delete_menu") {
              const deleteOptions = sessions.map((s: any) => {
                const formattedDate = new Date(s.createdAt).toLocaleString();
                return {
                  value: s.id,
                  label: `${s.id} - ${s.title || "Untitled"} (${formattedDate}) [${s.model}]`,
                };
              });
              deleteOptions.push({
                value: "cancel",
                label: "Cancel",
              });
              const idToDelete = await Prompt.askSelect(
                "Choose a session to delete:",
                deleteOptions,
              );

              if (idToDelete && idToDelete !== "cancel") {
                const confirm = await Prompt.askSelect(
                  `Are you sure you want to delete session ${idToDelete}?`,
                  [
                    { value: "yes", label: "Yes, delete it" },
                    { value: "no", label: "No, cancel" },
                  ],
                );

                if (confirm === "yes") {
                  handleDelete(idToDelete);
                }
              }
            } else if (selectedSessionId === "new") {
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
                  picocolors.green(
                    `✔ Switched to session: ${selectedSessionId}`,
                  ),
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
          } finally {
            try {
              tui.setCandidates(await getAutocompleteCandidates(cwd, config));
            } catch {}
            if (wasActive) tui.start(config.budgetLimit);
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
            printOutput(picocolors.yellow("Usage: /references <symbol_name>"));
            continue;
          }

          const indexPath = join(cwd, ".orbit", "symbols.json");
          if (!existsSync(indexPath)) {
            printOutput(
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

              const refLines: string[] = [];
              refLines.push(
                picocolors.bold(
                  picocolors.cyan(
                    `\n=== Symbol References Finder: ${symbolArg} ===`,
                  ),
                ),
              );
              if (exportedFile) {
                refLines.push(
                  `  🔑 Exported by: ${picocolors.green(exportedFile)}`,
                );
              } else {
                refLines.push(
                  `  🔑 Exported by: ${picocolors.gray("Unknown (Internal / Not exported)")}`,
                );
              }
              refLines.push(
                picocolors.gray(
                  "===========================================================",
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
                      refLines.push(
                        `  📁 ${picocolors.blue(file)}:${picocolors.yellow(idx + 1)}`,
                      );
                      refLines.push(
                        `     ${picocolors.gray(line.trim().substring(0, 80))}`,
                      );
                    }
                  }
                }
              }

              refLines.push(
                picocolors.gray(
                  "===========================================================",
                ),
              );
              refLines.push(
                `  Total Usages Found: ${picocolors.green(refCount)}`,
              );
              refLines.push(
                picocolors.cyan(
                  "===========================================================\n",
                ),
              );

              const wasActive = useFullscreenTui;
              if (wasActive) tui.stop();
              await pageText(refLines.join("\n"));
              if (wasActive) tui.start(config.budgetLimit);
            }
          } catch (err: any) {
            printOutput(
              picocolors.red(`Failed to search references: ${err.message}`),
            );
          }
          continue;
        }

        if (command === "/grep") {
          const query = parts.slice(1).join(" ").trim();
          const isZh = config.language === "zh";
          if (!query) {
            printOutput(
              isZh
                ? picocolors.yellow("用法: /grep <搜索内容>")
                : picocolors.yellow("Usage: /grep <query_pattern>"),
            );
            continue;
          }

          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();

          console.log(
            isZh
              ? picocolors.cyan(`\n正在搜索: "${query}"...`)
              : picocolors.cyan(`\nSearching for: "${query}"...`),
          );

          let matches: Array<{ file: string; line: number; content: string }> =
            [];

          try {
            // Try Ripgrep first
            try {
              const { execSync } = await import("child_process");
              const rgOutput = execSync(
                `rg --line-number --color=never --no-heading --glob "!.git/**" --glob "!node_modules/**" --glob "!dist/**" --glob "!build/**" --glob "!.orbit/**" "${query}"`,
                {
                  cwd,
                  stdio: ["ignore", "pipe", "ignore"],
                },
              ).toString();

              const lines = rgOutput.split("\n");
              for (const line of lines) {
                if (matches.length >= 100) break;
                if (!line.trim()) continue;
                const parts = line.split(":");
                if (parts.length >= 3) {
                  const filePath = parts[0].replace(/\\/g, "/");
                  const lineNum = parseInt(parts[1], 10);
                  const content = parts.slice(2).join(":");
                  matches.push({ file: filePath, line: lineNum, content });
                }
              }
            } catch {
              // Fallback to JS search
              const ignorePatterns = config.context?.ignore || [];
              const allFiles = await glob("**/*", {
                cwd,
                ignore: ignorePatterns,
                onlyFiles: true,
                dot: true,
                suppressErrors: true,
              });

              for (const file of allFiles) {
                if (matches.length >= 100) break;
                const filePath = join(cwd, file);
                const content = readFileSync(filePath, "utf8");
                if (content.includes(query)) {
                  const lines = content.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(query)) {
                      matches.push({
                        file: file.replace(/\\/g, "/"),
                        line: i + 1,
                        content: lines[i],
                      });
                      if (matches.length >= 100) break;
                    }
                  }
                }
              }
            }

            if (matches.length === 0) {
              console.log(
                isZh
                  ? picocolors.yellow("未找到匹配的代码行。")
                  : picocolors.yellow("No matches found."),
              );
            } else {
              let resultsText = isZh
                ? picocolors.bold(
                    picocolors.cyan(
                      `\n── 🔍 搜索结果 (共 ${matches.length} 项) ──\n`,
                    ),
                  )
                : picocolors.bold(
                    picocolors.cyan(
                      `\n── 🔍 Search Results (${matches.length} found) ──\n`,
                    ),
                  );

              const matchedFiles = Array.from(
                new Set(matches.map((m) => m.file)),
              );

              for (const m of matches) {
                resultsText += `${picocolors.green(m.file)}:${picocolors.yellow(m.line)}\n`;
                resultsText += `  ${picocolors.gray(m.content.trim().substring(0, 100))}\n`;
              }

              await pageText(resultsText);

              console.log("");
              const confirmAdd = await Prompt.askApproval(
                isZh
                  ? `发现 ${matchedFiles.length} 个相关文件。是否将它们全部添加到活动上下文中？`
                  : `Found ${matchedFiles.length} file(s). Add all of them to the active context?`,
              );

              if (confirmAdd) {
                for (const f of matchedFiles) {
                  loop.addRelevantFilePublic(
                    f,
                    `Matched query via /grep "${query}"`,
                  );
                }
                console.log(
                  isZh
                    ? picocolors.green(
                        `✔ 成功添加 ${matchedFiles.length} 个文件到上下文。`,
                      )
                    : picocolors.green(
                        `✔ Added ${matchedFiles.length} file(s) to active context.`,
                      ),
                );
              }
            }

            await Prompt.askText(
              isZh
                ? "按 Enter 键返回 Orbit..."
                : "Press Enter to return to Orbit...",
            );
          } catch (err: any) {
            console.log(
              isZh
                ? picocolors.red(`搜索失败: ${err.message}`)
                : picocolors.red(`Search failed: ${err.message}`),
            );
          } finally {
            tui.syncFromLoop(loop);
            if (wasActive) tui.start(config.budgetLimit);
          }
          continue;
        }

        if (command === "/language") {
          const langArg = parts.slice(1).join(" ").trim().toLowerCase();
          const activeConfig = loop.getConfig();
          let targetLang: "en" | "zh";

          if (langArg === "zh" || langArg === "cn" || langArg === "chinese") {
            targetLang = "zh";
          } else if (
            langArg === "en" ||
            langArg === "us" ||
            langArg === "english"
          ) {
            targetLang = "en";
          } else if (!langArg) {
            targetLang = activeConfig.language === "en" ? "zh" : "en";
          } else {
            const isZh = activeConfig.language === "zh";
            printOutput(
              isZh
                ? picocolors.red("无效的语言参数。请使用: /language [en|zh]")
                : picocolors.red(
                    "Invalid language argument. Use: /language [en|zh]",
                  ),
            );
            continue;
          }

          activeConfig.language = targetLang;
          config.language = targetLang;
          if (tui && (tui as any).config) {
            (tui as any).config.language = targetLang;
          }

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
          globalConfig.language = targetLang;
          try {
            const dir = pathDirname(globalConfigPath);
            if (!fsExists(dir)) {
              fsMkdir(dir, { recursive: true });
            }
            fsWrite(globalConfigPath, yamlStringify(globalConfig), "utf8");

            const isZh = targetLang === "zh";
            printOutput(
              isZh
                ? picocolors.green(
                    `✔ 语言已成功切换为：中文 (zh) 并保存至全局配置。`,
                  )
                : picocolors.green(
                    `✔ Language successfully switched to: English (en) and saved to global config.`,
                  ),
            );
          } catch (err: any) {
            const isZh = targetLang === "zh";
            printOutput(
              isZh
                ? picocolors.red(`无法保存全局配置: ${err.message}`)
                : picocolors.red(
                    `Failed to save global config: ${err.message}`,
                  ),
            );
          }
          continue;
        }

        if (command === "/fork") {
          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();
          try {
            const isZh = config.language === "zh";
            const activeSessionId =
              (loop as any).state?.sessionId ||
              loop.sessionManager.getActiveSession()?.id;
            if (!activeSessionId) {
              console.log(
                isZh
                  ? picocolors.red("✖ 没有活跃的会话可以 fork。")
                  : picocolors.red("✖ No active session to fork."),
              );
              continue;
            }

            const sub = parts[1]?.toLowerCase();

            const {
              copyFileSync,
              existsSync,
              readdirSync,
              mkdirSync,
              readFileSync,
              writeFileSync,
            } = await import("fs");
            const { join } = await import("path");
            const sessionsDir = join(cwd, ".orbit", "sessions");

            if (sub === "tree") {
              const sessions: any[] = [];
              if (existsSync(sessionsDir)) {
                const dirs = readdirSync(sessionsDir);
                for (const dir of dirs) {
                  const sessionFile = join(sessionsDir, dir, "session.json");
                  if (existsSync(sessionFile)) {
                    try {
                      const data = JSON.parse(
                        readFileSync(sessionFile, "utf8"),
                      );
                      sessions.push(data);
                    } catch {}
                  }
                }
              }

              if (sessions.length === 0) {
                console.log(
                  isZh
                    ? picocolors.yellow("没有找到任何会话。")
                    : picocolors.yellow("No sessions found."),
                );
                continue;
              }

              interface ExtendedNode {
                id: string;
                title: string;
                parentId?: string;
                model: string;
                createdAt: string;
                children: ExtendedNode[];
                isActive: boolean;
              }

              const nodeMap = new Map<string, ExtendedNode>();
              for (const s of sessions) {
                nodeMap.set(s.id, {
                  id: s.id,
                  title: s.title || "Untitled",
                  parentId: s.parentId,
                  model: s.model || "",
                  createdAt: s.createdAt || "",
                  children: [],
                  isActive: s.id === activeSessionId,
                });
              }

              const roots: ExtendedNode[] = [];
              for (const node of nodeMap.values()) {
                if (node.parentId && nodeMap.has(node.parentId)) {
                  nodeMap.get(node.parentId)!.children.push(node);
                } else {
                  roots.push(node);
                }
              }

              const sortNodes = (nodes: ExtendedNode[]) => {
                nodes.sort(
                  (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
                );
                for (const node of nodes) {
                  sortNodes(node.children);
                }
              };
              sortNodes(roots);

              console.log(
                isZh
                  ? picocolors.bold(
                      picocolors.cyan("\n=== Orbit 会话分支树 ===\n"),
                    )
                  : picocolors.bold(
                      picocolors.cyan("\n=== Orbit Session Branch Tree ===\n"),
                    ),
              );

              const printTreeNode = (
                node: ExtendedNode,
                prefix: string,
                isLast: boolean,
              ) => {
                const marker = node.isActive
                  ? picocolors.green("● (active) ")
                  : "  ";
                const branchChar =
                  prefix === "" ? "" : isLast ? "└── " : "├── ";
                const line = `${prefix}${branchChar}${marker}${picocolors.blue(node.id)} - ${node.title || "Untitled"} (${node.model})`;
                console.log(line);

                const nextPrefix =
                  prefix + (prefix === "" ? "" : isLast ? "    " : "│   ");
                for (let i = 0; i < node.children.length; i++) {
                  printTreeNode(
                    node.children[i],
                    nextPrefix,
                    i === node.children.length - 1,
                  );
                }
              };

              for (let i = 0; i < roots.length; i++) {
                printTreeNode(roots[i], "", i === roots.length - 1);
              }
              console.log(picocolors.cyan("=========================\n"));
              continue;
            }

            if (sub === "switch") {
              const sessions = loop.getSessions();
              let targetId = parts.slice(2).join(" ").trim();
              if (!targetId) {
                console.log(
                  isZh
                    ? picocolors.yellow("用法: /fork switch <会话ID | 索引>")
                    : picocolors.yellow(
                        "Usage: /fork switch <session_id | index>",
                      ),
                );
                continue;
              }
              const idx = parseInt(targetId, 10);
              if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
                targetId = sessions[idx - 1].id;
              }
              const found = sessions.find((s: any) => s.id === targetId);
              if (!found) {
                console.log(
                  isZh
                    ? picocolors.red(`✖ 会话不存在: ${targetId}`)
                    : picocolors.red(`✖ Session not found: ${targetId}`),
                );
                continue;
              }

              const success = loop.resumeSession(targetId);
              if (success) {
                tui.loadHistory(loop.getHistory());
                console.log(
                  isZh
                    ? picocolors.green(`✔ 已切换到会话: ${targetId}`)
                    : picocolors.green(`✔ Switched to session: ${targetId}`),
                );

                saveLocalState(cwd, {
                  lastSessionId: targetId,
                  lastModel: loop.getModelOverride() || config.models.default,
                });
              } else {
                console.log(
                  isZh
                    ? picocolors.red(`✖ 切换会话失败: ${targetId}`)
                    : picocolors.red(`✖ Failed to resume session: ${targetId}`),
                );
              }
              continue;
            }

            // Default Fork Logic
            const forkName = parts.slice(1).join(" ").trim();
            const newSessionId = generateId("sess");
            const srcDir = join(sessionsDir, activeSessionId);
            const destDir = join(sessionsDir, newSessionId);

            if (!existsSync(srcDir)) {
              console.log(
                isZh
                  ? picocolors.red(`✖ 会话目录不存在: ${srcDir}`)
                  : picocolors.red(`✖ Session directory not found: ${srcDir}`),
              );
              continue;
            }

            mkdirSync(destDir, { recursive: true });

            const files = readdirSync(srcDir);
            for (const file of files) {
              const srcFile = join(srcDir, file);
              const destFile = join(destDir, file);
              copyFileSync(srcFile, destFile);
            }

            const sessionJsonFile = join(destDir, "session.json");
            if (existsSync(sessionJsonFile)) {
              try {
                const sessionData = JSON.parse(
                  readFileSync(sessionJsonFile, "utf8"),
                );
                sessionData.id = newSessionId;
                sessionData.title = forkName || `Fork of ${activeSessionId}`;
                sessionData.parentId = activeSessionId; // Save parent lineage
                sessionData.createdAt = new Date().toISOString();
                sessionData.updatedAt = new Date().toISOString();
                writeFileSync(
                  sessionJsonFile,
                  JSON.stringify(sessionData, null, 2),
                  "utf8",
                );
              } catch (err: any) {
                console.log(
                  isZh
                    ? picocolors.yellow(
                        `警告: 更新 session.json 失败: ${err.message}`,
                      )
                    : picocolors.yellow(
                        `Warning: Failed to update session.json: ${err.message}`,
                      ),
                );
              }
            }

            const success = loop.resumeSession(newSessionId);
            if (success) {
              tui.loadHistory(loop.getHistory());
              console.log(
                isZh
                  ? picocolors.green(
                      `✔ 成功 Fork 并切换到新会话: ${newSessionId}`,
                    )
                  : picocolors.green(
                      `✔ Successfully forked and switched to new session: ${newSessionId}`,
                    ),
              );
              saveLocalState(cwd, {
                lastSessionId: newSessionId,
                lastModel: loop.getModelOverride() || config.models.default,
              });
            } else {
              console.log(
                isZh
                  ? picocolors.red(`✖ 切换到新会话 ${newSessionId} 失败。`)
                  : picocolors.red(
                      `✖ Failed to resume new session ${newSessionId}.`,
                    ),
              );
            }
          } catch (err: any) {
            console.log(
              picocolors.red(`Error forking session: ${err.message}`),
            );
          } finally {
            try {
              tui.setCandidates(await getAutocompleteCandidates(cwd, config));
            } catch {}
            tui.syncFromLoop(loop);
            if (wasActive) tui.start(config.budgetLimit);
          }
          continue;
        }

        if (command === "/mode" || command === "/ask" || command === "/code") {
          const isZh = config.language === "zh";
          let targetMode = "";
          if (command === "/ask") {
            targetMode = "strict";
          } else if (command === "/code") {
            targetMode = "normal";
          } else {
            targetMode = parts.slice(1).join(" ").trim().toLowerCase();
          }

          if (!targetMode) {
            console.log(
              isZh
                ? picocolors.yellow("用法: /mode <strict|normal|auto|plan>")
                : picocolors.yellow("Usage: /mode <strict|normal|auto|plan>"),
            );
            continue;
          }

          const validModes = ["strict", "normal", "auto", "plan"];
          if (!validModes.includes(targetMode)) {
            console.log(
              isZh
                ? picocolors.red(
                    `✖ 无效的安全模式: ${targetMode}。可选模式: ${validModes.join(", ")}`,
                  )
                : picocolors.red(
                    `✖ Invalid security mode: ${targetMode}. Valid modes: ${validModes.join(", ")}`,
                  ),
            );
            continue;
          }

          loop.getConfig().permissions.mode = targetMode as any;
          console.log(
            isZh
              ? picocolors.green(
                  `✔ 已切换安全模式至: ${targetMode.toUpperCase()}`,
                )
              : picocolors.green(
                  `✔ Switched security mode to: ${targetMode.toUpperCase()}`,
                ),
          );
          tui.syncFromLoop(loop);
          continue;
        }

        if (command === "/copy") {
          const isZh = config.language === "zh";
          const history = loop.getHistory();
          const lastAssistantMsg = [...history]
            .reverse()
            .find((msg) => msg.role === "assistant");

          if (!lastAssistantMsg) {
            console.log(
              isZh
                ? picocolors.yellow("没有找到 AI 的最近回复。")
                : picocolors.yellow(
                    "No recent assistant response found to copy.",
                  ),
            );
            continue;
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
            console.log(
              isZh
                ? picocolors.yellow("AI 的最近回复内容为空。")
                : picocolors.yellow("Recent assistant response is empty."),
            );
            continue;
          }

          const copied = copyToClipboard(textToCopy);
          if (copied) {
            console.log(
              isZh
                ? picocolors.green("✔ 已成功复制 AI 最近回复到剪贴板！")
                : picocolors.green(
                    "✔ Successfully copied recent AI response to clipboard!",
                  ),
            );
          } else {
            console.log(
              isZh
                ? picocolors.red(
                    "✖ 复制到剪贴板失败，系统未配置剪贴板工具（如 pbcopy/clip/xclip）。",
                  )
                : picocolors.red(
                    "✖ Failed to copy to clipboard. Ensure pbcopy/clip/xclip is installed.",
                  ),
            );
          }
          continue;
        }

        if (command === "/copy-context") {
          const isZh = config.language === "zh";
          const files = loop.getRelevantFiles();
          if (files.length === 0) {
            console.log(
              isZh
                ? picocolors.yellow("当前活动上下文为空，无可复制的内容。")
                : picocolors.yellow("No files in the active context to copy."),
            );
            continue;
          }

          const fileListStr = files.map((f) => f.path).join("\n");
          const copied = copyToClipboard(fileListStr);
          if (copied) {
            console.log(
              isZh
                ? picocolors.green("✔ 已成功复制上下文文件列表到剪贴板！")
                : picocolors.green(
                    "✔ Successfully copied context file list to clipboard!",
                  ),
            );
          } else {
            console.log(
              isZh
                ? picocolors.red("✖ 复制到剪贴板失败。")
                : picocolors.red("✖ Failed to copy to clipboard."),
            );
          }
          continue;
        }

        if (command === "/git") {
          const wasActive = useFullscreenTui && tui.isActive;
          if (wasActive) tui.stop();

          const gitArgs = parts.slice(1).join(" ").trim();
          const isZh = config.language === "zh";

          if (!gitArgs) {
            console.log(
              isZh
                ? picocolors.yellow("用法: /git <git_arguments>，如: /git diff")
                : picocolors.yellow(
                    "Usage: /git <git_arguments>, e.g.: /git diff",
                  ),
            );
            if (wasActive) tui.start(config.budgetLimit);
            continue;
          }

          const shellCmd = `git ${gitArgs}`;
          const permissionEngine = new PermissionEngine(config);
          const decision = permissionEngine.evaluate(
            "bash",
            { command: shellCmd },
            "execute",
          );
          if (decision.action === "deny") {
            console.log(
              picocolors.red(
                isZh
                  ? `✖ Git 命令已被安全策略阻止: ${decision.reason}`
                  : `✖ Git command blocked by safety policy: ${decision.reason}`,
              ),
            );
            if (wasActive) tui.start(config.budgetLimit);
            continue;
          }
          if (decision.action === "ask") {
            const approved = await Prompt.askApproval(
              isZh
                ? `Git 命令需要 ${decision.risk} 权限：${shellCmd}`
                : `Git command requires ${decision.risk} permission: ${shellCmd}`,
            );
            if (!approved) {
              console.log(
                picocolors.yellow(
                  isZh ? "已取消 Git 命令。" : "Git command cancelled.",
                ),
              );
              if (wasActive) tui.start(config.budgetLimit);
              continue;
            }
          }
          console.log(
            isZh
              ? picocolors.cyan(`\n正在执行 Git 命令: ${shellCmd}...`)
              : picocolors.cyan(`\nRunning Git command: ${shellCmd}...`),
          );

          try {
            const { spawnSync } = await import("child_process");
            const result = spawnSync(shellCmd, {
              cwd,
              stdio: "inherit",
              shell: true,
            });

            if (result.status === 0) {
              console.log(
                isZh
                  ? picocolors.green(`\n✔ 命令执行成功。`)
                  : picocolors.green(`\n✔ Command completed successfully.`),
              );
            } else {
              console.log(
                isZh
                  ? picocolors.red(
                      `\n✖ 命令执行失败，退出代码: ${result.status}`,
                    )
                  : picocolors.red(
                      `\n✖ Command failed with exit code ${result.status}`,
                    ),
              );
            }
            await Prompt.askText(
              isZh
                ? "按 Enter 键返回 Orbit..."
                : "Press Enter to return to Orbit...",
            );
          } catch (err: any) {
            console.log(
              isZh
                ? picocolors.red(`无法执行 Git 命令: ${err.message}`)
                : picocolors.red(
                    `Failed to execute Git command: ${err.message}`,
                  ),
            );
          } finally {
            tui.syncFromLoop(loop);
            if (wasActive) tui.start(config.budgetLimit);
          }
          continue;
        }

        if (command === "/btw") {
          const isZh = config.language === "zh";
          let question = parts.slice(1).join(" ").trim();
          if (!question) {
            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();
            question =
              (await Prompt.askText(
                isZh
                  ? "输入你要咨询的快捷问题（不会记入当前会话历史）:"
                  : "Enter your quick side-question (won't be saved to session history):",
              )) || "";
            if (wasActive) tui.start(config.budgetLimit);
          }

          if (!question.trim()) {
            continue;
          }

          console.log(isZh ? "\n正在查询回答..." : "\nQuerying answer...");
          try {
            const fastModel = config.models.fast || config.models.default;
            const stream = providerInstance.chat({
              model: fastModel,
              messages: [
                {
                  id: `msg_btw_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [
                    {
                      type: "text",
                      text: question,
                    },
                  ],
                },
              ],
              tools: [],
            });

            let fullAnswer = "";
            for await (const event of stream) {
              if (event.type === "text_delta") {
                process.stdout.write(event.text);
                fullAnswer += event.text;
              }
            }
            console.log("\n");
            console.log(
              picocolors.dim(
                isZh
                  ? "💡 [提示：此快捷问答未记入会话历史，不消耗后续 Token]"
                  : "💡 [BTW: This side-question turn was not saved to session history to save tokens.]",
              ),
            );
            console.log("");
          } catch (err: any) {
            console.log(picocolors.red(`✖ Failed: ${err.message}`));
          }
          continue;
        }

        if (command === "/memory") {
          const isZh = config.language === "zh";
          const { existsSync, readFileSync } = await import("fs");

          const candidates = [
            join(cwd, "ORBIT.md"),
            join(cwd, ".agents", "AGENTS.md"),
            join(cwd, "AGENTS.md"),
            join(cwd, "CLAUDE.md"),
            join(cwd, "RUNE.md"),
            join(cwd, ".cursorrules"),
            join(cwd, ".copilotrules"),
            join(cwd, "README.md"),
          ];

          let foundPath = "";
          for (const p of candidates) {
            if (existsSync(p)) {
              foundPath = p;
              break;
            }
          }

          if (foundPath) {
            console.log(
              picocolors.cyan(
                isZh
                  ? `\n=== 当前项目规则与记忆 (${foundPath}) ===\n`
                  : `\n=== Active Project Guidelines & Memory (${foundPath}) ===\n`,
              ),
            );
            const content = readFileSync(foundPath, "utf8");
            console.log(content);
            console.log(
              picocolors.cyan(
                "========================================================\n",
              ),
            );
          } else {
            console.log(
              picocolors.yellow(
                isZh
                  ? "未找到本地项目规则文件（ORBIT.md, AGENTS.md, CLAUDE.md, RUNE.md, .cursorrules 或 .copilotrules）。"
                  : "No active project memory/rules file found (ORBIT.md, AGENTS.md, CLAUDE.md, RUNE.md, .cursorrules or .copilotrules).",
              ),
            );

            const wasActive = useFullscreenTui && tui.isActive;
            if (wasActive) tui.stop();
            const create = await Prompt.askApproval(
              isZh
                ? "是否在当前项目根目录下自动创建 .agents/AGENTS.md 规则记忆文件？"
                : "Create a standard .agents/AGENTS.md project memory file?",
            );
            if (wasActive) tui.start(config.budgetLimit);

            if (create) {
              const fs = await import("fs");
              const dir = join(cwd, ".agents");
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              const template = [
                "# Project Guidelines & Memory",
                "",
                "## Technology Stack",
                "- Node.js & TypeScript",
                "",
                "## Coding Standards",
                "- Write clean, type-safe ES Modules",
                "- Ensure all tests compile and pass",
                "",
              ].join("\n");
              fs.writeFileSync(join(dir, "AGENTS.md"), template, "utf8");
              console.log(
                picocolors.green(
                  isZh
                    ? "✔ 成功创建 .agents/AGENTS.md。你可以随时修改以自定义 Agent 行为。"
                    : "✔ Successfully created .agents/AGENTS.md. You can edit it to guide the agent.",
                ),
              );
            }
          }
          continue;
        }

        if (command === "/tokens") {
          const isZh = config.language === "zh";
          const inputTokens = (loop as any).totalInputTokens || 0;
          const outputTokens = (loop as any).totalOutputTokens || 0;
          const cacheReadTokens = (loop as any).totalCacheReadTokens || 0;
          const currentCost = loop.getSessionCost();
          const budgetLimit = loop.getConfig().budgetLimit;

          const tokensText = [
            picocolors.bold(
              picocolors.cyan("\n=== Orbit Session Token Usage & Cost ==="),
            ),
            `  📥 Input Tokens:       ${picocolors.green(inputTokens.toLocaleString())}`,
            `  💾 Cache Read Tokens:  ${picocolors.green(cacheReadTokens.toLocaleString())}`,
            `  📤 Output Tokens:      ${picocolors.green(outputTokens.toLocaleString())}`,
            `  💰 Session Cost:       ${picocolors.green(`$${currentCost.toFixed(4)}`)} / $${budgetLimit.toFixed(2)} (Limit)`,
            picocolors.cyan("========================================\n"),
          ].join("\n");
          printOutput(tokensText);
          continue;
        }

        if (command === "/new" || command === "/reset") {
          const wasActive = useFullscreenTui && tui.isActive;
          try {
            const activeModel =
              loop.getModelOverride() || config.models.default;
            const newSessionId = loop.startNewSession(
              providerInstance.id,
              activeModel,
            );
            tui.loadHistory([]);

            if (wasActive && !tui.isActive) {
              tui.start(config.budgetLimit);
            }

            printOutput(
              picocolors.green(
                config.language === "zh"
                  ? `✔ 成功创建并启动新会话: ${newSessionId}`
                  : `✔ Started new session: ${newSessionId}`,
              ),
            );

            saveLocalState(cwd, {
              lastSessionId: newSessionId,
              lastModel: activeModel,
            });
          } catch (err: any) {
            if (wasActive && !tui.isActive) {
              tui.start(config.budgetLimit);
            }
            printOutput(
              picocolors.red(`Error starting new session: ${err.message}`),
            );
          } finally {
            try {
              tui.setCandidates(await getAutocompleteCandidates(cwd, config));
            } catch {}
            tui.syncFromLoop(loop);
          }
          continue;
        }

        if (command === "/delete" || command === "/rm" || command === "/del") {
          const wasActive = useFullscreenTui && tui.isActive;
          let stoppedTui = false;
          const stopTuiIfNeeded = () => {
            if (wasActive && !stoppedTui) {
              tui.stop();
              stoppedTui = true;
            }
          };
          const restoreTuiAndPrint = (msg: string) => {
            if (wasActive && stoppedTui && !tui.isActive) {
              tui.start(config.budgetLimit);
              stoppedTui = false;
            }
            printOutput(msg);
          };

          try {
            const isZh = config.language === "zh";
            const sessions = loop.getSessions();
            let idToDelete = parts.slice(1).join(" ").trim();

            if (!idToDelete) {
              if (sessions.length === 0) {
                restoreTuiAndPrint(
                  picocolors.yellow(
                    isZh
                      ? "没有找到任何保存的会话来删除。"
                      : "No active or saved sessions found to delete.",
                  ),
                );
                continue;
              }
              const deleteOptions = sessions.map((s: any) => {
                const formattedDate = new Date(s.createdAt).toLocaleString();
                return {
                  value: s.id,
                  label: `${s.id} - ${s.title || "Untitled"} (${formattedDate}) [${s.model}]`,
                };
              });
              deleteOptions.push({
                value: "cancel",
                label: "Cancel",
              });
              stopTuiIfNeeded();
              idToDelete = await Prompt.askSelect(
                isZh ? "选择要删除的会话：" : "Choose a session to delete:",
                deleteOptions,
              );
            } else {
              const idx = parseInt(idToDelete, 10);
              if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
                idToDelete = sessions[idx - 1].id;
              } else {
                const found = sessions.find((s: any) => s.id === idToDelete);
                if (!found) {
                  restoreTuiAndPrint(
                    picocolors.red(
                      isZh
                        ? `✖ 未找到该会话: ${idToDelete}`
                        : `✖ Session not found: ${idToDelete}`,
                    ),
                  );
                  continue;
                }
              }
            }

            if (!idToDelete || idToDelete === "cancel") {
              continue;
            }

            // Only ask for confirmation if no argument was passed (interactive mode)
            let confirm = "yes";
            const hasArg = !!parts.slice(1).join(" ").trim();
            if (!hasArg) {
              stopTuiIfNeeded();
              confirm = await Prompt.askSelect(
                isZh
                  ? `您确定要删除会话 ${idToDelete} 吗？`
                  : `Are you sure you want to delete session ${idToDelete}?`,
                [
                  {
                    value: "yes",
                    label: isZh ? "是，删除它" : "Yes, delete it",
                  },
                  { value: "no", label: isZh ? "否，取消" : "No, cancel" },
                ],
              );
            }

            if (confirm === "yes") {
              loop.deleteSession(idToDelete);

              const activeSession =
                (loop as any).state?.sessionId ||
                (loop as any).sessionManager.getActiveSession()?.id;
              let switchMsg = "";
              if (activeSession === idToDelete) {
                const remaining = loop.getSessions();
                if (remaining.length > 0) {
                  const targetSession = remaining[0];
                  const success = loop.resumeSession(targetSession.id);
                  if (success) {
                    tui.loadHistory(loop.getHistory());
                    switchMsg = isZh
                      ? `✔ 已自动切换到会话: ${targetSession.id}`
                      : `✔ Automatically switched to session: ${targetSession.id}`;
                    saveLocalState(cwd, {
                      lastSessionId: targetSession.id,
                      lastModel:
                        loop.getModelOverride() || config.models.default,
                    });
                  }
                } else {
                  const activeModel =
                    loop.getModelOverride() || config.models.default;
                  const newSessionId = loop.startNewSession(
                    providerInstance.id,
                    activeModel,
                  );
                  tui.loadHistory([]);
                  switchMsg = isZh
                    ? `✔ 已自动启动新会话: ${newSessionId}`
                    : `✔ Automatically started new session: ${newSessionId}`;
                  saveLocalState(cwd, {
                    lastSessionId: newSessionId,
                    lastModel: activeModel,
                  });
                }
              }

              // Restore TUI and print success
              restoreTuiAndPrint(
                picocolors.green(
                  isZh
                    ? `✔ 会话 ${idToDelete} 已成功删除。`
                    : `✔ Session ${idToDelete} deleted successfully.`,
                ),
              );
              if (switchMsg) {
                restoreTuiAndPrint(picocolors.green(switchMsg));
              }
            }
          } catch (err: any) {
            restoreTuiAndPrint(
              picocolors.red(`Error deleting session: ${err.message}`),
            );
          } finally {
            if (wasActive && stoppedTui && !tui.isActive) {
              tui.start(config.budgetLimit);
            }
            try {
              tui.setCandidates(await getAutocompleteCandidates(cwd, config));
            } catch {}
            tui.syncFromLoop(loop);
          }
          continue;
        }

        printOutput(
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

      // Auto-generate session title if it's the default title
      const activeSession = loop.sessionManager.getActiveSession();
      if (
        activeSession &&
        (activeSession.title === "New Orbit Session" || !activeSession.title)
      ) {
        const fastModel = config.models.fast || config.models.default;
        const firstPrompt = trimmed;
        Promise.resolve().then(async () => {
          try {
            const stream = providerInstance.chat({
              model: fastModel,
              messages: [
                {
                  id: `msg_title_gen_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [
                    {
                      type: "text",
                      text: `Summarize the following user task into a very concise title (max 5 words, e.g. "Fix button layout" or "Add login unit tests"). Output ONLY the title, no markdown, no punctuation, no quotes:\n\n${firstPrompt.substring(0, 1000)}`,
                    },
                  ],
                },
              ],
              tools: [],
            });
            let title = "";
            for await (const event of stream) {
              if (event.type === "text_delta") {
                title += event.text;
              }
            }
            const finalTitle = title.trim().replace(/^["']|["']$/g, "");
            if (
              finalTitle &&
              activeSession.id === loop.sessionManager.getActiveSession()?.id
            ) {
              activeSession.title = finalTitle;
              loop.sessionManager
                .getSessionStore()
                .updateSession(activeSession);
            }
          } catch {
            // Ignore background title generation errors
          }
        });
      }

      let orchestratorInstance: Orchestrator | null = null;
      if (multi) {
        orchestratorInstance = new Orchestrator(
          cwd,
          config,
          providerInstance,
          trimmed,
          tuiInteraction,
        );
        tui.setActiveRunnable(orchestratorInstance);
      } else {
        tui.setActiveRunnable(loop);
      }

      tui.startThinkingInput();

      try {
        if (orchestratorInstance) {
          await orchestratorInstance.run();
        } else {
          await loop.run();
        }
      } finally {
        tui.stopThinkingInput();
        tui.setActiveRunnable(null);
      }

      // If a guided correction was entered during execution, loop to append and rerun
      while (tui.pendingGuidedStatement) {
        const guidedTask = tui.pendingGuidedStatement;
        tui.pendingGuidedStatement = null;

        const isZh = config.language === "zh";
        tuiInteraction.showText(
          isZh
            ? `\n● 收到引导指令。正在重新规划思考...`
            : `\n● Guided instruction received. Replanning execution...`,
        );

        state.task = guidedTask;
        state.done = false;
        state.attemptCount = 0;
        state.history.push({
          id: `msg_user_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: guidedTask }],
        });

        tui.syncFromLoop(loop);

        let subOrchestrator: Orchestrator | null = null;
        if (multi) {
          subOrchestrator = new Orchestrator(
            cwd,
            config,
            providerInstance,
            guidedTask,
            tuiInteraction,
          );
          tui.setActiveRunnable(subOrchestrator);
        } else {
          tui.setActiveRunnable(loop);
        }

        tui.startThinkingInput();

        try {
          if (subOrchestrator) {
            await subOrchestrator.run();
          } else {
            await loop.run();
          }
        } finally {
          tui.stopThinkingInput();
          tui.setActiveRunnable(null);
        }
      }
      tui.syncFromLoop(loop);
      tui.finishAttempt();

      // Refresh candidates in the background asynchronously
      getAutocompleteCandidates(cwd, config)
        .then((c) => {
          candidates = c;
          tui.setCandidates(c);
        })
        .catch(() => {});
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    watcher?.close();
    if (watchTimeout) clearTimeout(watchTimeout);
    eventBus.off("model_delta", onModelDelta);
    eventBus.off("loop_start", onLoopStart);
    eventBus.off("cost_update", onCostUpdate);
    eventBus.off("thinking_delta", onThinkingDelta);
    tui.dispose();
    autocompleteServer?.close();
    currentTui = null;
  }
}

async function getAutocompleteCandidates(
  cwd: string,
  config: any,
): Promise<{
  commands: string[];
  files: string[];
  symbols: string[];
  sessions: string[];
}> {
  const customCommands = loadCustomCommands(cwd, BUILTIN_SLASH_COMMANDS);
  const commands = [
    ...BUILTIN_SLASH_COMMANDS,
    ...customCommands.map((command) => `/${command.name}`),
  ];
  const files: string[] = [];
  const symbols: string[] = [];
  const sessions: string[] = [];

  const normCwd = resolve(cwd).toLowerCase().replace(/\\/g, "/");
  const normHome = resolve(homedir()).toLowerCase().replace(/\\/g, "/");
  const isHomeOrRoot =
    normCwd === normHome ||
    normCwd === "/" ||
    /^[a-zA-Z]:\/$/.test(normCwd) ||
    dirname(normCwd) === normCwd;

  if (isHomeOrRoot) {
    return {
      commands,
      files,
      symbols,
      sessions,
    };
  }

  try {
    const ignorePatterns = config.context?.ignore || [];
    const globbedFiles = await glob("**/*", {
      cwd,
      ignore: ignorePatterns,
      onlyFiles: true,
      dot: true,
      suppressErrors: true,
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

  try {
    const sessionDir = join(cwd, ".orbit", "sessions");
    if (existsSync(sessionDir)) {
      const { readdirSync: fsReaddir, existsSync: fsExists } =
        await import("fs");
      const dirs = fsReaddir(sessionDir);
      for (const dir of dirs) {
        const sessionFile = join(sessionDir, dir, "session.json");
        if (fsExists(sessionFile)) {
          sessions.push(dir);
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
    sessions,
  };
}

function makeCompleter(candidates: {
  commands: string[];
  files: string[];
  symbols: string[];
  sessions: string[];
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

function copyToClipboard(text: string): boolean {
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
  } catch (err) {
    return false;
  }
}
