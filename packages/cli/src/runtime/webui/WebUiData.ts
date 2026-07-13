import { redactSecrets } from "@orbit-build/shared";
import { buildCacheDiagnostics } from "../CacheDiagnostics.js";
import {
  formatModelOptionLabel,
  getProviderModelCandidates,
} from "../ModelCatalog.js";
import type {
  ActiveWebTurn,
  WebUiLoopSnapshot,
  WebUiOptions,
} from "./WebUiContracts.js";
import { sanitizeBaseUrl } from "./WebUiSecurity.js";

type WebMessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      name: string;
      status: "running" | "success" | "error";
      isError?: boolean;
    };

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
      historyMessages: Array.isArray(history) ? visibleMessages.length : 0,
      cost: safeCall(() => loop?.getSessionCost?.()) || 0,
      inputTokens: safeCall(() => loop?.getTotalInputTokens?.()) || 0,
      cacheReadTokens: safeCall(() => loop?.getTotalCacheReadTokens?.()) || 0,
      outputTokens: safeCall(() => loop?.getTotalOutputTokens?.()) || 0,
    },
    context: {
      relevantFiles: Array.isArray(relevantFiles) ? relevantFiles.length : 0,
      maxFiles: config.context.maxFilesToIndex,
      compactThreshold: config.context.compactThreshold,
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
    cacheDiagnostics: redactSecrets(stripAnsi(buildCacheDiagnostics(cwd))),
    updatedAt: new Date().toISOString(),
  };
}

/** Normalize AgentLoop history into the narrow browser message contract. */
export function collectWebUiMessages(loop?: WebUiLoopSnapshot) {
  const history = safeCall(() => loop?.getHistory?.()) || [];
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => !isInternalWebMessage(message))
    .map((message, index) => normalizeMessage(message, index));
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
        name:
          typeof candidate.toolCall.name === "string"
            ? candidate.toolCall.name
            : "tool",
        status: "running",
      });
      continue;
    }
    if (candidate.type === "tool_result" && isRecord(candidate.toolResult)) {
      const isError = candidate.toolResult.isError === true;
      blocks.push({
        type: "tool",
        name:
          typeof candidate.toolResult.name === "string"
            ? candidate.toolResult.name
            : "tool",
        status: isError ? "error" : "success",
        ...(isError ? { isError: true } : {}),
      });
    }
  }
  return blocks;
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

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
