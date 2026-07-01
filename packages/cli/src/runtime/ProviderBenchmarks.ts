import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import picocolors from "picocolors";

export interface ProviderBenchmarkResult {
  providerId: string;
  model: string;
  checkedAt: string;
  promptHash: string;
  promptChars: number;
  maxTokens: number;
  firstDeltaMs?: number;
  totalMs: number;
  outputTokens: number;
  textChars: number;
  throughputTokensPerSec: number;
  cacheReadTokens: number;
  cacheInputTokens: number;
  cacheHitRate: number;
  error?: string;
}

export function providerBenchmarkPath(cwd: string): string {
  return join(cwd, ".orbit", "provider-benchmarks.json");
}

export function benchmarkPromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

export function readProviderBenchmarks(cwd: string): ProviderBenchmarkResult[] {
  const path = providerBenchmarkPath(cwd);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed?.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

export function recordProviderBenchmark(
  cwd: string,
  result: ProviderBenchmarkResult,
): void {
  try {
    const path = providerBenchmarkPath(cwd);
    const existing = readProviderBenchmarks(cwd);
    const next = [result, ...existing].slice(0, 200);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ results: next }, null, 2), "utf8");
    renameSync(tmp, path);
  } catch {
    // Benchmark history is diagnostic-only and should never block the CLI.
  }
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index];
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function formatProviderBenchmarkSummary(
  cwd: string,
  providerId: string,
  model: string,
): string {
  const samples = readProviderBenchmarks(cwd)
    .filter((item) => item.providerId === providerId && item.model === model)
    .slice(0, 20);

  if (samples.length === 0) {
    return picocolors.gray(
      "● Provider benchmark: no local samples yet. Run `orbit bench --repeat 3` to build a latency profile.",
    );
  }

  const successful = samples.filter((item) => !item.error);
  const latest = samples[0];
  if (successful.length === 0) {
    return picocolors.yellow(
      `⚠ Provider benchmark: ${samples.length} recent sample(s), latest failed: ${latest.error || "unknown error"}.`,
    );
  }

  const firstDeltas = successful
    .map((item) => item.firstDeltaMs)
    .filter((value): value is number => typeof value === "number");
  const totals = successful.map((item) => item.totalMs);
  const tps = successful
    .map((item) => item.throughputTokensPerSec)
    .filter((value) => value > 0);
  const cacheHit = successful.map((item) => item.cacheHitRate);
  const latestText = latest.error
    ? `latest failed=${latest.error}`
    : `latest first=${latest.firstDeltaMs ?? "n/a"}ms total=${latest.totalMs}ms`;
  const firstP50 = percentile(firstDeltas, 0.5);
  const firstP90 = percentile(firstDeltas, 0.9);
  const totalP50 = percentile(totals, 0.5);
  const avgTps = avg(tps);
  const avgCache = avg(cacheHit);
  const slowFirstToken =
    typeof firstP50 === "number" && firstP50 >= 2500 ? " slow-first-token" : "";

  const color = slowFirstToken ? picocolors.yellow : picocolors.green;
  return color(
    `● Provider benchmark:${slowFirstToken} samples=${successful.length}/${samples.length}; ${latestText}; p50 first=${firstP50 ?? "n/a"}ms p90 first=${firstP90 ?? "n/a"}ms p50 total=${totalP50 ?? "n/a"}ms avg=${avgTps ? avgTps.toFixed(1) : "n/a"} tok/s cache=${Math.round((avgCache || 0) * 100)}%.`,
  );
}

export function compareProviderBenchmarkResults(
  results: ProviderBenchmarkResult[],
): string {
  const successful = results.filter(
    (item) => !item.error && typeof item.firstDeltaMs === "number",
  );
  if (successful.length === 0) {
    return picocolors.yellow(
      "● Benchmark comparison: no successful samples to rank.",
    );
  }

  const grouped = new Map<string, ProviderBenchmarkResult[]>();
  for (const result of successful) {
    const key = `${result.providerId}::${result.model}`;
    const current = grouped.get(key) || [];
    current.push(result);
    grouped.set(key, current);
  }

  const rows = Array.from(grouped.entries())
    .map(([key, items]) => {
      const [providerId, model] = key.split("::");
      const first = avg(
        items
          .map((item) => item.firstDeltaMs)
          .filter((value): value is number => typeof value === "number"),
      );
      const total = avg(items.map((item) => item.totalMs));
      const throughput = avg(
        items
          .map((item) => item.throughputTokensPerSec)
          .filter((value) => value > 0),
      );
      const cache = avg(items.map((item) => item.cacheHitRate));
      return {
        providerId,
        model,
        samples: items.length,
        first: first || Number.POSITIVE_INFINITY,
        total: total || Number.POSITIVE_INFINITY,
        throughput: throughput || 0,
        cache: cache || 0,
      };
    })
    .sort(
      (a, b) =>
        a.first - b.first || a.total - b.total || b.throughput - a.throughput,
    );

  const lines = [picocolors.bold("Benchmark Comparison")];
  rows.forEach((row, index) => {
    const leader = index === 0 ? "best " : "";
    lines.push(
      `${index + 1}. ${leader}${row.providerId} / ${row.model}: first=${Math.round(
        row.first,
      )}ms total=${Math.round(row.total)}ms avg=${row.throughput.toFixed(
        1,
      )} tok/s cache=${Math.round(row.cache * 100)}% samples=${row.samples}`,
    );
  });
  return lines.join("\n");
}
