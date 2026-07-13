import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_V4_FLASH,
  DEEPSEEK_V4_PRO,
  getDeepSeekReasoningEffort,
  getDeepSeekV4ModelProfile,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";

describe("DeepSeek V4 model profile", () => {
  it("recognizes only the exact official HTTPS endpoint", () => {
    expect(isOfficialDeepSeekApi("https://api.deepseek.com")).toBe(true);
    expect(isOfficialDeepSeekApi("https://api.deepseek.com/v1")).toBe(true);
    expect(
      isOfficialDeepSeekApi("https://api.deepseek.com:443/anthropic"),
    ).toBe(true);
    expect(isOfficialDeepSeekApi("http://api.deepseek.com")).toBe(false);
    expect(isOfficialDeepSeekApi("https://api.deepseek.com.evil.test")).toBe(
      false,
    );
    expect(isOfficialDeepSeekApi("https://api.deepseek.com:444")).toBe(false);
    expect(isOfficialDeepSeekApi("https://api.deepseek.com?key=secret")).toBe(
      false,
    );
    expect(isOfficialDeepSeekApi("https://api.deepseek.com/#fragment")).toBe(
      false,
    );
    expect(isOfficialDeepSeekApi("https://lookalike@api.deepseek.com/v1")).toBe(
      false,
    );
  });

  it("canonicalizes Claude Code suffixes and preserves alias thinking modes", () => {
    expect(getDeepSeekV4ModelProfile("deepseek-v4-pro[1m]")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_PRO,
      lane: "pro",
      optimizedThinkingDefault: true,
    });
    expect(getDeepSeekV4ModelProfile("deepseek-chat")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_FLASH,
      legacyAlias: true,
      optimizedThinkingDefault: false,
    });
    expect(getDeepSeekV4ModelProfile("deepseek-reasoner")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_FLASH,
      legacyAlias: true,
      optimizedThinkingDefault: true,
    });
  });

  it("maps Orbit thinking budgets to the only supported V4 effort levels", () => {
    expect(getDeepSeekReasoningEffort(4096)).toBe("high");
    expect(getDeepSeekReasoningEffort(8192)).toBe("max");
  });
});
