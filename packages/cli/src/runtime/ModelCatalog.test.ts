import { describe, expect, it } from "vitest";
import {
  describeDeprecatedDeepSeekAliases,
  formatModelOptionLabel,
  getDeepSeekAliasReplacement,
  getProviderModelCandidates,
  isDeprecatedDeepSeekAlias,
} from "./ModelCatalog.js";

describe("ModelCatalog", () => {
  it("should prefer configured provider models", () => {
    const models = getProviderModelCandidates({
      provider: { default: "ciyuan" },
      providers: {
        ciyuan: {
          type: "openai-compatible",
          models: ["vendor/fast", "vendor/reasoner"],
        },
      },
    });

    expect(models).toEqual(["vendor/fast", "vendor/reasoner"]);
  });

  it("should provide current default OpenAI and Anthropic candidates", () => {
    expect(
      getProviderModelCandidates({
        provider: { default: "openai" },
        providers: { openai: { type: "openai" } },
      }),
    ).toContain("gpt-5.5");
    expect(
      getProviderModelCandidates({
        provider: { default: "anthropic" },
        providers: { anthropic: { type: "anthropic" } },
      }),
    ).toContain("claude-sonnet-4-6");
  });

  it("describes DeepSeek legacy aliases with V4 replacements", () => {
    expect(isDeprecatedDeepSeekAlias("deepseek-chat")).toBe(true);
    expect(getDeepSeekAliasReplacement("deepseek-reasoner")).toBe(
      "deepseek-v4-pro",
    );
    expect(formatModelOptionLabel("deepseek-chat")).toContain(
      "deprecated -> deepseek-v4-flash",
    );
    expect(
      describeDeprecatedDeepSeekAliases([
        "deepseek-chat",
        "deepseek-reasoner",
        "deepseek-v4-flash",
      ]),
    ).toContain("2026-07-24T15:59:00Z");
  });
});
