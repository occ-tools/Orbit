import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
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
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    };

    const result = await probeProviderCapabilities(cwd, config, provider);
    const cached = readProviderProbeCache(cwd);

    expect(result.observed.streamStarted).toBe(true);
    expect(result.observed.usageReturned).toBe(true);
    expect(cached[0].providerId).toBe("gateway");
    expect(cached[0].model).toBe("vendor/fast");
  });
});
