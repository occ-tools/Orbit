import { describe, expect, it } from "vitest";
import {
  describeDeprecatedDeepSeekAliases,
  formatModelOptionLabel,
  getDeepSeekAliasMigration,
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

  it("only exposes official DeepSeek V4 candidates by default", () => {
    const models = getProviderModelCandidates({
      provider: { default: "deepseek-openai" },
      providers: { "deepseek-openai": { type: "openai-compatible" } },
    });

    expect(models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(
      getProviderModelCandidates({
        provider: { default: "deepseek-anthropic" },
        providers: {
          "deepseek-anthropic": { type: "anthropic-compatible" },
        },
      }),
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });

  it("describes DeepSeek legacy aliases with V4 replacements", () => {
    expect(isDeprecatedDeepSeekAlias("deepseek-chat")).toBe(true);
    expect(getDeepSeekAliasReplacement("deepseek-reasoner")).toBe(
      "deepseek-v4-flash",
    );
    expect(getDeepSeekAliasMigration("deepseek-reasoner")).toEqual({
      model: "deepseek-v4-flash",
      thinking: "high",
    });
    expect(formatModelOptionLabel("deepseek-chat")).toContain(
      "deprecated -> deepseek-v4-flash",
    );
    expect(
      describeDeprecatedDeepSeekAliases([
        "deepseek-chat",
        "deepseek-reasoner",
        "deepseek-v4-flash",
      ]),
    ).toContain("deepseek-reasoner -> deepseek-v4-flash (thinking high)");
  });
});
