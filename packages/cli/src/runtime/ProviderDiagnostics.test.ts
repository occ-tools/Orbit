import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  formatProviderProbe,
  probeProviderCapabilities,
  readProviderProbeCache,
} from "./ProviderDiagnostics.js";
import type { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";

describe("ProviderDiagnostics", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("probes streaming and usage support and caches the result", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-provider-probe-"));
    dirs.push(cwd);
    const config = {
      models: { default: "vendor/fast" },
    } as OrbitConfig;
    const provider: ModelProvider = {
      id: "gateway",
      type: "openai-compatible",
      capabilities: {
        streaming: true,
        toolCalls: false,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: false,
      },
      async *chat() {
        yield { type: "text_delta", text: "ok" };
        yield {
          type: "usage",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            cacheReadTokens: 1,
            cacheMissTokens: 0,
          },
        };
      },
    };

    const result = await probeProviderCapabilities(cwd, config, provider);
    const cached = readProviderProbeCache(cwd);

    expect(result.observed.streamStarted).toBe(true);
    expect(result.observed.usageReturned).toBe(true);
    expect(result.observed.cacheUsageReturned).toBe(true);
    expect(result.observed.totalTokensReturned).toBe(true);
    expect(formatProviderProbe(result)).toContain("cacheUsage=yes");
    expect(cached[0].providerId).toBe("gateway");
    expect(cached[0].model).toBe("vendor/fast");
  });

  it("formats older probe cache entries with unknown new fields as n/a", () => {
    const text = formatProviderProbe({
      providerId: "deepseek-openai",
      model: "deepseek-v4-flash",
      checkedAt: "2026-07-02T00:00:00.000Z",
      declared: {
        streaming: true,
        toolCalls: true,
        jsonMode: true,
        thinking: false,
        vision: false,
        promptCaching: true,
      },
      observed: {
        streamStarted: true,
        usageReturned: true,
        firstDeltaMs: 900,
      },
    });

    expect(text).toContain("cacheUsage=n/a");
    expect(text).not.toContain("declared cache support");
  });
});
