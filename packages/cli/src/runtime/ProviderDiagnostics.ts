import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import type { OrbitConfig } from "@orbit-build/config";
import type {
  ModelCapabilities,
  ModelProvider,
} from "@orbit-build/model-providers";

export interface ProviderProbeResult {
  providerId: string;
  model: string;
  checkedAt: string;
  declared: ModelCapabilities;
  observed: {
    streamStarted: boolean;
    usageReturned: boolean;
    cacheUsageReturned?: boolean;
    totalTokensReturned?: boolean;
    error?: string;
    firstDeltaMs?: number;
  };
}

export function providerProbeCachePath(cwd: string): string {
  return join(cwd, ".orbit", "provider-capabilities.json");
}

export function readProviderProbeCache(cwd: string): ProviderProbeResult[] {
  const path = providerProbeCachePath(cwd);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed?.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

export function writeProviderProbeCache(
  cwd: string,
  result: ProviderProbeResult,
): void {
  try {
    const path = providerProbeCachePath(cwd);
    const existing = readProviderProbeCache(cwd);
    const next = [
      result,
      ...existing.filter(
        (item) =>
          item.providerId !== result.providerId || item.model !== result.model,
      ),
    ].slice(0, 50);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ results: next }, null, 2), "utf8");
    renameSync(tmp, path);
  } catch {
    // Diagnostics cache should never block the CLI.
  }
}

export async function probeProviderCapabilities(
  cwd: string,
  config: OrbitConfig,
  provider: ModelProvider,
  options: { timeoutMs?: number } = {},
): Promise<ProviderProbeResult> {
  const model = config.models.default;
  const declared = (typeof provider.getModelCapabilities === "function"
    ? provider.getModelCapabilities(model)
    : provider.capabilities) || {
    streaming: false,
    toolCalls: false,
    jsonMode: false,
    thinking: false,
    vision: false,
    promptCaching: false,
  };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 6000,
  );
  timeout.unref?.();
  const result: ProviderProbeResult = {
    providerId: provider.id,
    model,
    checkedAt: new Date().toISOString(),
    declared,
    observed: {
      streamStarted: false,
      usageReturned: false,
      cacheUsageReturned: false,
      totalTokensReturned: false,
    },
  };

  try {
    const stream = provider.chat({
      model,
      messages: [
        {
          id: `msg_provider_probe_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: "Reply with ok." }],
        },
      ],
      tools: [],
      stream: true,
      maxTokens: 4,
      abortSignal: controller.signal,
    });

    for await (const event of stream) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        if (!result.observed.streamStarted) {
          result.observed.streamStarted = true;
          result.observed.firstDeltaMs = Date.now() - startedAt;
        }
      } else if (event.type === "usage") {
        result.observed.usageReturned = true;
        result.observed.totalTokensReturned =
          typeof event.usage.totalTokens === "number" &&
          event.usage.totalTokens > 0;
        result.observed.cacheUsageReturned =
          typeof event.usage.cacheReadTokens === "number" ||
          typeof event.usage.cacheMissTokens === "number" ||
          typeof event.usage.cacheWriteTokens === "number";
      } else if (event.type === "error") {
        result.observed.error = event.error?.message || String(event.error);
        break;
      }
      if (result.observed.streamStarted && result.observed.usageReturned) {
        break;
      }
    }
  } catch (error: any) {
    result.observed.error = error?.message || String(error);
  } finally {
    clearTimeout(timeout);
  }

  writeProviderProbeCache(cwd, result);
  return result;
}

export function formatProviderProbe(result: ProviderProbeResult): string {
  const observed = result.observed;
  const cacheUsage =
    typeof observed.cacheUsageReturned === "boolean"
      ? observed.cacheUsageReturned
        ? "yes"
        : "no"
      : "n/a";
  const totalTokens =
    typeof observed.totalTokensReturned === "boolean"
      ? observed.totalTokensReturned
        ? "yes"
        : "no"
      : "n/a";
  const warnings: string[] = [];
  if (result.declared.streaming && !observed.streamStarted) {
    warnings.push("declared streaming but no stream delta observed");
  }
  if (!observed.usageReturned) {
    warnings.push("usage metadata missing");
  }
  if (
    result.declared.promptCaching &&
    observed.cacheUsageReturned === false
  ) {
    warnings.push("declared cache support but no cache usage fields observed");
  }

  return [
    `Provider probe: ${result.providerId} / ${result.model}`,
    `- declared: streaming=${result.declared.streaming} tools=${result.declared.toolCalls} thinking=${result.declared.thinking} cache=${result.declared.promptCaching}`,
    `- observed: stream=${observed.streamStarted ? "yes" : "no"} usage=${observed.usageReturned ? "yes" : "no"} cacheUsage=${cacheUsage} totalTokens=${totalTokens} firstDelta=${observed.firstDeltaMs ?? "n/a"}ms`,
    warnings.length > 0 ? `- warnings: ${warnings.join("; ")}` : "",
    observed.error ? `- error: ${observed.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
