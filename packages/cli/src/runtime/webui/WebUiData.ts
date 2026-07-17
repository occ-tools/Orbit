import { redactSecrets } from "@orbit-build/shared";
import { buildCacheDiagnostics } from "../CacheDiagnostics.js";
import {
  formatModelOptionLabel,
  getProviderModelCandidates,
} from "../ModelCatalog.js";
import type {
  ActiveWebTurn,
  WebUiApprovalSnapshot,
  WebUiLoopSnapshot,
  WebUiOptions,
} from "./WebUiContracts.js";
import { sanitizeBaseUrl, summarizeWebToolValue } from "./WebUiSecurity.js";

type WebMessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "success" | "error";
      detail?: string;
      isError?: boolean;
    };

/** Filter and rank workspace-relative file paths for the Web UI picker. */
export function filterWebUiCompletionFiles(
  files: string[],
  rawQuery: string,
  limit = 60,
): string[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const normalized = Array.from(
    new Set(
      files
        .map((file) => normalizeSafeWebUiPath(file))
        .filter((file): file is string => Boolean(file)),
    ),
  );

  return normalized
    .filter((file) => {
      const lower = file.toLocaleLowerCase();
      return terms.every((term) => lower.includes(term));
    })
    .sort((left, right) => {
      const leftScore = completionFileScore(left, query);
      const rightScore = completionFileScore(right, query);
      return leftScore - rightScore || left.localeCompare(right);
    })
    .slice(0, Math.max(1, Math.min(100, limit)));
}

/** Normalize active context files into a bounded browser-safe summary. */
export function summarizeWebUiContextFiles(
  value: unknown,
  limit = 24,
): {
  files: Array<{ path: string; readOnly: boolean }>;
  total: number;
  truncated: boolean;
} {
  const files: Array<{ path: string; readOnly: boolean }> = [];
  const seen = new Set<string>();
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (!isRecord(candidate)) continue;
      const path = normalizeSafeWebUiPath(candidate.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      files.push({ path, readOnly: candidate.readOnly === true });
    }
  }
  const safeLimit = Math.max(1, Math.min(100, limit));
  return {
    files: files.slice(0, safeLimit),
    total: files.length,
    truncated: files.length > safeLimit,
  };
}

function normalizeSafeWebUiPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (
    !path ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.startsWith("/") ||
    /^[a-zA-Z]:\//.test(path) ||
    path.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }
  return path;
}

function completionFileScore(file: string, query: string): number {
  const lower = file.toLocaleLowerCase();
  const basename = lower.slice(lower.lastIndexOf("/") + 1);
  const depth = file.split("/").length - 1;
  if (!query) return depth * 100 + file.length;
  if (basename === query) return 0;
  if (basename.startsWith(query)) return 100 + depth * 4 + file.length;
  if (basename.includes(query)) return 200 + depth * 4 + file.length;
  if (lower.startsWith(query)) return 300 + depth * 4 + file.length;
  return 400 + lower.indexOf(query) + depth * 4 + file.length;
}

/** Build the credential-safe status snapshot returned by `/api/status`. */
export function collectWebUiStatus(
  options: WebUiOptions,
  activeTurn: ActiveWebTurn | undefined,
) {
  const { cwd, config, loop } = options;
  const sessions = safeCall(() => loop?.getSessions?.()) || [];
  const relevantFiles = safeCall(() => loop?.getRelevantFiles?.()) || [];
  const history = safeCall(() => loop?.getHistory?.()) || [];
  const visibleMessages = collectWebUiMessages(loop);
  const sessionId = safeCall(() => loop?.getSessionId?.()) || "";
  const providerId = config.provider.default || "unknown";
  const provider = config.providers[providerId] || {};
  const activeModel = getActiveModel(options);
  const contextStatus = safeCall(() => loop?.getContextWindowStatus?.());
  const contextFiles = summarizeWebUiContextFiles(relevantFiles);
  const recentSessions = normalizeSessions(sessions, sessionId);

  return {
    workspace: cwd,
    provider: {
      id: providerId,
      type: provider.type || "unknown",
      baseUrl: sanitizeBaseUrl(provider.baseUrl),
    },
    models: config.models,
    activeModel,
    modelOptions: buildModelOptions(options, activeModel),
    permissions: { mode: config.permissions.mode },
    tools: {
      webSearch: {
        enabled: config.tools.webSearch.enabled,
        provider: config.tools.webSearch.provider,
        maxResults: config.tools.webSearch.maxResults,
      },
      mcp: { enabled: config.tools.mcp.enabled },
    },
    skills: { enabled: config.skills.enabled },
    session: {
      activeId: sessionId,
      count: Array.isArray(sessions) ? sessions.length : 0,
      recent: recentSessions,
      historyMessages: Array.isArray(history) ? visibleMessages.length : 0,
      cost: safeCall(() => loop?.getSessionCost?.()) || 0,
      inputTokens: safeCall(() => loop?.getTotalInputTokens?.()) || 0,
      cacheReadTokens: safeCall(() => loop?.getTotalCacheReadTokens?.()) || 0,
      outputTokens: safeCall(() => loop?.getTotalOutputTokens?.()) || 0,
    },
    context: {
      relevantFiles: contextFiles.total,
      files: contextFiles.files,
      filesTruncated: contextFiles.truncated,
      maxFiles: config.context.maxFilesToIndex,
      compactThreshold: config.context.compactThreshold,
      model: contextStatus?.model || activeModel,
      maxContextTokens: finiteNumber(contextStatus?.maxContextTokens),
      compactAtTokens: finiteNumber(contextStatus?.compactAtTokens),
      estimatedHistoryTokens: finiteNumber(
        contextStatus?.estimatedHistoryTokens,
      ),
      utilization: finiteNumber(contextStatus?.utilization),
    },
    turn: activeTurn
      ? {
          active: true,
          id: activeTurn.id,
          sessionId: activeTurn.sessionId,
          startedAt: activeTurn.startedAt,
          cancelRequested: activeTurn.cancelRequested,
        }
      : { active: false },
    approval: collectWebUiApproval(
      safeCall(() => options.getPendingApproval?.()),
    ),
    cacheDiagnostics: redactSecrets(stripAnsi(buildCacheDiagnostics(cwd))),
    updatedAt: new Date().toISOString(),
  };
}

/** Normalize a pending confirmation before exposing it to the browser. */
export function collectWebUiApproval(
  value: unknown,
): WebUiApprovalSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    !["tool", "change", "action"].includes(String(value.kind))
  ) {
    return undefined;
  }
  const title = safeApprovalText(value.title, 200, false);
  const reason = safeApprovalText(value.reason, 1_500, false);
  if (!title || !reason) return undefined;
  return {
    id: safeApprovalText(value.id, 200, false),
    kind: value.kind as WebUiApprovalSnapshot["kind"],
    title,
    reason,
    preview: value.preview
      ? safeApprovalText(value.preview, 24_000, true)
      : undefined,
    toolCallId: value.toolCallId
      ? safeApprovalText(value.toolCallId, 200, false)
      : undefined,
    requestedAt:
      typeof value.requestedAt === "string"
        ? safeApprovalText(value.requestedAt, 100, false)
        : "",
  };
}

function safeApprovalText(
  value: unknown,
  maxLength: number,
  preserveLines: boolean,
): string {
  if (typeof value !== "string") return "";
  const safe = redactSecrets(stripAnsi(value)).replace(
    preserveLines
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
      : /[\u0000-\u001f\u007f]/g,
    " ",
  );
  return (preserveLines ? safe : safe.replace(/\s+/g, " "))
    .trim()
    .slice(0, maxLength);
}

function normalizeSessions(sessions: unknown, activeId: string) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter(isRecord)
    .map((session) => ({
      id: typeof session.id === "string" ? session.id : "",
      title:
        typeof session.title === "string" && session.title.trim()
          ? redactSecrets(session.title.trim()).slice(0, 160)
          : "Untitled task",
      model: typeof session.model === "string" ? session.model : "",
      updatedAt:
        typeof session.updatedAt === "string"
          ? session.updatedAt
          : typeof session.createdAt === "string"
            ? session.createdAt
            : "",
      active: session.id === activeId,
    }))
    .filter((session) => session.id)
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })
    .slice(0, 8);
}

/** Normalize AgentLoop history into the narrow browser message contract. */
export function collectWebUiMessages(loop?: WebUiLoopSnapshot) {
  const history = safeCall(() => loop?.getHistory?.()) || [];
  if (!Array.isArray(history)) return [];
  const normalized = history
    .filter((message) => !isInternalWebMessage(message))
    .map((message, index) => normalizeMessage(message, index));
  return mergeAssistantTurns(mergeToolResultMessages(normalized));
}

/** Build the editable settings snapshot returned by `/api/settings`. */
export function collectWebUiSettings(options: WebUiOptions) {
  const { config } = options;
  const activeModel = getActiveModel(options);
  return {
    model: activeModel,
    modelOptions: buildModelOptions(options, activeModel),
    permissionMode: config.permissions.mode,
    webSearchEnabled: config.tools.webSearch.enabled,
    webSearchProvider: config.tools.webSearch.provider,
    webSearchMaxResults: config.tools.webSearch.maxResults,
  };
}

function getActiveModel(options: WebUiOptions): string {
  return (
    safeCall(() => options.loop?.getModelOverride?.()) ||
    options.config.models.default
  );
}

function buildModelOptions(options: WebUiOptions, activeModel: string) {
  const { config } = options;
  const providerId = config.provider.default;
  return Array.from(
    new Set([
      activeModel,
      config.models.default,
      config.models.fast,
      config.models.planner,
      config.models.coder,
      config.models.reviewer,
      config.models.summarizer,
      ...getProviderModelCandidates(config, providerId),
    ]),
  )
    .map((model) => model?.trim())
    .filter((model): model is string => Boolean(model))
    .map((model) => ({ id: model, label: formatModelOptionLabel(model) }));
}

function normalizeMessage(message: unknown, index: number) {
  const record = isRecord(message) ? message : {};
  const role =
    record.role === "user" ||
    record.role === "assistant" ||
    record.role === "tool"
      ? record.role
      : "assistant";
  const blocks = normalizeMessageBlocks(record.content);
  return {
    id: typeof record.id === "string" ? record.id : `message-${index}`,
    role,
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt : undefined,
    text: blocks
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("\n"),
    blocks,
  };
}

function normalizeMessageBlocks(content: unknown): WebMessageBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: WebMessageBlock[] = [];
  for (const candidate of content) {
    if (!isRecord(candidate)) continue;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      blocks.push({ type: "text", text: candidate.text });
      continue;
    }
    if (candidate.type === "thinking" && typeof candidate.text === "string") {
      blocks.push({ type: "thinking", text: candidate.text });
      continue;
    }
    if (candidate.type === "tool_call" && isRecord(candidate.toolCall)) {
      blocks.push({
        type: "tool",
        id:
          typeof candidate.toolCall.id === "string"
            ? candidate.toolCall.id
            : "",
        name:
          typeof candidate.toolCall.name === "string"
            ? candidate.toolCall.name
            : "tool",
        status: "running",
        ...toolDetail(candidate.toolCall.arguments),
      });
      continue;
    }
    if (candidate.type === "tool_result" && isRecord(candidate.toolResult)) {
      const isError = candidate.toolResult.isError === true;
      blocks.push({
        type: "tool",
        id:
          typeof candidate.toolResult.toolCallId === "string"
            ? candidate.toolResult.toolCallId
            : "",
        name:
          typeof candidate.toolResult.name === "string"
            ? candidate.toolResult.name
            : "tool",
        status: isError ? "error" : "success",
        ...(isError
          ? toolDetail(candidate.toolResult.content, { allowPlainText: true })
          : {}),
        ...(isError ? { isError: true } : {}),
      });
    }
  }
  return blocks;
}

function mergeToolResultMessages(
  messages: ReturnType<typeof normalizeMessage>[],
) {
  const pending = new Map<string, Extract<WebMessageBlock, { type: "tool" }>>();
  const merged: ReturnType<typeof normalizeMessage>[] = [];
  for (const message of messages) {
    const remaining: WebMessageBlock[] = [];
    for (const block of message.blocks) {
      if (block.type !== "tool" || !block.id) {
        remaining.push(block);
        continue;
      }
      if (block.status === "running") {
        pending.set(block.id, block);
        remaining.push(block);
        continue;
      }
      const proposal = pending.get(block.id);
      if (!proposal) {
        remaining.push(block);
        continue;
      }
      proposal.status = block.status;
      if (block.isError) proposal.isError = true;
      else delete proposal.isError;
      if (block.detail) proposal.detail = block.detail;
      pending.delete(block.id);
    }
    if (message.role !== "tool" || message.text || remaining.length) {
      merged.push({ ...message, blocks: remaining });
    }
  }
  return merged;
}

function mergeAssistantTurns(messages: ReturnType<typeof normalizeMessage>[]) {
  const merged: ReturnType<typeof normalizeMessage>[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (message.role !== "user" && previous && previous.role !== "user") {
      previous.blocks.push(...message.blocks);
      previous.text = [previous.text, message.text]
        .filter(Boolean)
        .join("\n\n");
      continue;
    }
    merged.push({ ...message, blocks: [...message.blocks] });
  }
  return merged;
}

function toolDetail(
  value: unknown,
  options: { allowPlainText?: boolean } = {},
): { detail: string } | Record<string, never> {
  const detail = summarizeWebToolValue(value, options);
  return detail ? { detail } : {};
}

function isInternalWebMessage(message: unknown): boolean {
  if (!isRecord(message)) return true;
  if (message.role === "system") return true;
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  return (
    metadata.kind === "orbit_volatile_context" ||
    metadata.kind === "history_compaction_summary"
  );
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
