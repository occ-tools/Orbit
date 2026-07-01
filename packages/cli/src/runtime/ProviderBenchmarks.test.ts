import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  compareProviderBenchmarkResults,
  formatProviderBenchmarkSummary,
  readProviderBenchmarks,
  recordProviderBenchmark,
} from "./ProviderBenchmarks.js";

describe("ProviderBenchmarks", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records samples without storing prompt text and summarizes latency", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-bench-"));
    dirs.push(cwd);

    recordProviderBenchmark(cwd, {
      providerId: "deepseek-openai",
      model: "deepseek-v4-flash",
      checkedAt: "2026-07-01T00:00:00.000Z",
      promptHash: "abc123",
      promptChars: 14,
      maxTokens: 96,
      firstDeltaMs: 2800,
      totalMs: 3300,
      outputTokens: 30,
      textChars: 90,
      throughputTokensPerSec: 9.1,
      cacheReadTokens: 0,
      cacheInputTokens: 8,
      cacheHitRate: 0,
    });

    const samples = readProviderBenchmarks(cwd);
    const summary = formatProviderBenchmarkSummary(
      cwd,
      "deepseek-openai",
      "deepseek-v4-flash",
    );

    expect(samples).toHaveLength(1);
    expect(JSON.stringify(samples)).not.toContain("Reply with ok");
    expect(summary).toContain("slow-first-token");
    expect(summary).toContain("p50 first=2800ms");
  });

  it("ranks benchmark comparison by first-token latency", () => {
    const comparison = compareProviderBenchmarkResults([
      {
        providerId: "gateway",
        model: "slow",
        checkedAt: "2026-07-01T00:00:00.000Z",
        promptHash: "a",
        promptChars: 1,
        maxTokens: 16,
        firstDeltaMs: 1200,
        totalMs: 1800,
        outputTokens: 20,
        textChars: 60,
        throughputTokensPerSec: 11,
        cacheReadTokens: 0,
        cacheInputTokens: 8,
        cacheHitRate: 0,
      },
      {
        providerId: "gateway",
        model: "fast",
        checkedAt: "2026-07-01T00:00:01.000Z",
        promptHash: "a",
        promptChars: 1,
        maxTokens: 16,
        firstDeltaMs: 300,
        totalMs: 700,
        outputTokens: 20,
        textChars: 60,
        throughputTokensPerSec: 28,
        cacheReadTokens: 0,
        cacheInputTokens: 8,
        cacheHitRate: 0,
      },
    ]);

    expect(comparison).toContain("1. best gateway / fast");
    expect(comparison.indexOf("fast")).toBeLessThan(comparison.indexOf("slow"));
  });
});
