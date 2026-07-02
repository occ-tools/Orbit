import { ConfigLoader } from "@orbit-build/config";
import picocolors from "picocolors";
import type { ModelProvider } from "@orbit-build/model-providers";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";
import {
  benchmarkPromptHash,
  compareProviderBenchmarkResults,
  formatProviderBenchmarkSummary,
  recordProviderBenchmark,
  type ProviderBenchmarkResult,
} from "../runtime/ProviderBenchmarks.js";

async function runSingleBench(
  provider: ModelProvider,
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<ProviderBenchmarkResult> {
  const startedAt = Date.now();
  let firstDeltaMs: number | undefined;
  let textChars = 0;
  let outputTokens = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheMissTokens = 0;
  let error: string | undefined;

  try {
    const stream = provider.chat({
      model,
      messages: [
        {
          id: `msg_bench_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: prompt }],
        },
      ],
      tools: [],
      stream: true,
      maxTokens,
    });

    for await (const event of stream) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        if (firstDeltaMs === undefined) {
          firstDeltaMs = Date.now() - startedAt;
        }
        textChars += event.text.length;
      } else if (event.type === "usage") {
        inputTokens = event.usage.inputTokens || 0;
        outputTokens = event.usage.outputTokens || 0;
        cacheReadTokens = event.usage.cacheReadTokens || 0;
        cacheMissTokens = event.usage.cacheMissTokens || 0;
      } else if (event.type === "error") {
        error = event.error?.message || String(event.error);
        break;
      }
    }
  } catch (err: any) {
    error = err?.message || String(err);
  }

  const totalMs = Math.max(1, Date.now() - startedAt);
  const throughputTokensPerSec =
    outputTokens > 0 ? outputTokens / (totalMs / 1000) : 0;
  const cacheInputTokens = cacheReadTokens + cacheMissTokens || inputTokens;
  const cacheHitRate =
    cacheInputTokens > 0 ? cacheReadTokens / cacheInputTokens : 0;

  return {
    providerId: provider.id,
    model,
    checkedAt: new Date().toISOString(),
    promptHash: benchmarkPromptHash(prompt),
    promptChars: prompt.length,
    maxTokens,
    firstDeltaMs,
    totalMs,
    outputTokens,
    textChars,
    throughputTokensPerSec,
    cacheReadTokens,
    cacheInputTokens,
    cacheHitRate,
    error,
  };
}

function clampRepeat(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

function clampMaxTokens(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 96;
  return Math.max(1, Math.min(4096, Math.floor(parsed)));
}

function parseModels(options: { model?: string; models?: string }): string[] {
  const raw = options.models || options.model || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCacheProfilePrompt(): string {
  const stablePrefix = [
    "Orbit DeepSeek cache profile stable prefix.",
    "This block is intentionally repeated to test provider-side context caching.",
    "Keep this prefix byte-stable across benchmark rounds.",
  ].join(" ");
  return `${Array.from({ length: 180 }, () => stablePrefix).join("\n")}\n\nReply with exactly: ok`;
}

export function evaluateCacheProfile(results: ProviderBenchmarkResult[]): {
  successful: ProviderBenchmarkResult[];
  cold?: ProviderBenchmarkResult;
  warm: ProviderBenchmarkResult[];
  bestWarm?: ProviderBenchmarkResult;
  warmAvgHit: number;
  speedup: string;
} {
  const successful = results.filter((item) => !item.error);
  const cold = successful[0];
  const warm = successful.slice(1);
  const bestWarm = [...warm].sort(
    (a, b) =>
      (a.firstDeltaMs ?? Number.POSITIVE_INFINITY) -
      (b.firstDeltaMs ?? Number.POSITIVE_INFINITY),
  )[0];
  const warmAvgHit =
    warm.length > 0
      ? warm.reduce((sum, item) => sum + item.cacheHitRate, 0) / warm.length
      : 0;
  const speedup =
    typeof cold?.firstDeltaMs === "number" &&
    typeof bestWarm?.firstDeltaMs === "number" &&
    bestWarm.firstDeltaMs > 0
      ? `${(cold.firstDeltaMs / bestWarm.firstDeltaMs).toFixed(1)}x`
      : "n/a";

  return { successful, cold, warm, bestWarm, warmAvgHit, speedup };
}

export function formatCacheProfileSummary(
  results: ProviderBenchmarkResult[],
): string {
  const profile = evaluateCacheProfile(results);
  const successful = profile.successful;
  if (successful.length === 0) {
    return picocolors.yellow("Cache Profile: no successful samples.");
  }

  const cold = profile.cold!;
  const warm = profile.warm;
  const bestWarm = profile.bestWarm;
  const warmAvgHit = profile.warmAvgHit;
  const coldFirst = cold.firstDeltaMs ?? "n/a";
  const bestWarmFirst = bestWarm?.firstDeltaMs ?? "n/a";
  const verdict =
    warmAvgHit >= 0.75
      ? picocolors.green("cache warm")
      : warm.length > 0
        ? picocolors.yellow("cache weak")
        : picocolors.yellow("cache not measured");

  return [
    picocolors.bold("Cache Profile"),
    `Status: ${verdict}`,
    `Cold first delta: ${coldFirst}ms · cache=${Math.round(cold.cacheHitRate * 100)}% (${cold.cacheReadTokens}/${cold.cacheInputTokens})`,
    `Best warm first delta: ${bestWarmFirst}ms · warm avg cache=${Math.round(
      warmAvgHit * 100,
    )}% · speedup=${profile.speedup}`,
    `Prompt hash: ${cold.promptHash} · prompt chars=${cold.promptChars}`,
    "Interpretation: DeepSeek cache is expected to be cold on round 1; warm rounds should show high cacheReadTokens for the same stable prefix.",
  ].join("\n");
}

function printBenchResult(
  result: ProviderBenchmarkResult,
  index: number,
): void {
  const suffix = index > 1 ? ` #${index}` : "";
  console.log(picocolors.bold(`Orbit Bench${suffix}`));
  console.log(`Provider: ${picocolors.cyan(result.providerId)}`);
  console.log(`Model: ${picocolors.cyan(result.model)}`);
  console.log(`First delta: ${result.firstDeltaMs ?? "n/a"}ms`);
  console.log(`Total: ${result.totalMs}ms`);
  console.log(
    `Output: ${result.outputTokens || "n/a"} tokens, ${result.textChars} chars`,
  );
  console.log(
    `Throughput: ${
      result.throughputTokensPerSec
        ? result.throughputTokensPerSec.toFixed(1)
        : "n/a"
    } tokens/sec`,
  );
  console.log(
    `Cache: ${Math.round(result.cacheHitRate * 100)}% (${result.cacheReadTokens}/${result.cacheInputTokens})`,
  );
  if (result.error) {
    console.log(picocolors.red(`Error: ${result.error}`));
  }
}

function clampCacheHitThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

export async function runBench(
  cwd: string,
  options: {
    prompt?: string;
    provider?: string;
    model?: string;
    models?: string;
    repeat?: number;
    maxTokens?: number;
    cacheProfile?: boolean;
    minCacheHit?: number | string;
    json?: boolean;
  } = {},
): Promise<void> {
  const overrides = options.provider
    ? ({ provider: { default: options.provider } } as any)
    : undefined;
  const config = ConfigLoader.loadSync(cwd, overrides);
  const provider = createProviderFromConfig(config);
  const models = parseModels(options);
  if (models.length === 0) {
    models.push(config.models.fast || config.models.default);
  }
  const prompt = options.cacheProfile
    ? options.prompt || buildCacheProfilePrompt()
    : options.prompt ||
      "Reply with one concise sentence explaining what Orbit is.";
  const repeat = options.cacheProfile
    ? Math.max(3, clampRepeat(options.repeat))
    : clampRepeat(options.repeat);
  const maxTokens = clampMaxTokens(options.maxTokens);
  const minCacheHit = clampCacheHitThreshold(options.minCacheHit);
  const results: ProviderBenchmarkResult[] = [];
  const cacheProfileGroups = new Map<string, ProviderBenchmarkResult[]>();

  for (const model of models) {
    for (let i = 0; i < repeat; i++) {
      const result = await runSingleBench(provider, model, prompt, maxTokens);
      recordProviderBenchmark(cwd, result);
      results.push(result);
      if (options.cacheProfile) {
        const key = `${result.providerId}\0${result.model}`;
        const group = cacheProfileGroups.get(key) || [];
        group.push(result);
        cacheProfileGroups.set(key, group);
      }
      if (!options.json) {
        printBenchResult(result, i + 1);
        if (i < repeat - 1 || models.length > 1) {
          console.log("");
        }
      }
    }
    if (!options.json) {
      console.log(formatProviderBenchmarkSummary(cwd, provider.id, model));
      if (model !== models.at(-1)) {
        console.log("");
      }
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          results,
          ...(options.cacheProfile
            ? { cacheProfile: { promptHash: results[0]?.promptHash } }
            : {}),
        },
        null,
        2,
      ),
    );
  } else if (options.cacheProfile) {
    console.log("");
    console.log(
      [...cacheProfileGroups.values()]
        .map((group) => formatCacheProfileSummary(group))
        .join("\n\n"),
    );
  } else if (models.length > 1 || repeat > 1) {
    console.log("");
    console.log(compareProviderBenchmarkResults(results));
  }

  if (options.cacheProfile && minCacheHit !== undefined) {
    const failures = [...cacheProfileGroups.values()]
      .map((group) => {
        const profile = evaluateCacheProfile(group);
        const sample = group[0];
        return {
          providerId: sample?.providerId || "unknown",
          model: sample?.model || "unknown",
          warmAvgHit: profile.warmAvgHit,
          warmSamples: profile.warm.length,
        };
      })
      .filter(
        (item) => item.warmSamples === 0 || item.warmAvgHit < minCacheHit,
      );

    if (failures.length > 0) {
      process.exitCode = 1;
      const lines = failures.map(
        (item) =>
          `${item.providerId} / ${item.model}: warm cache=${Math.round(
            item.warmAvgHit * 100,
          )}% samples=${item.warmSamples}`,
      );
      console.error(
        picocolors.red(
          `Cache profile threshold failed: expected warm cache >= ${Math.round(
            minCacheHit * 100,
          )}%. ${lines.join("; ")}`,
        ),
      );
    }
  }
}
