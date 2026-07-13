export const DEEPSEEK_V4_FLASH = "deepseek-v4-flash";
export const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
export const DEEPSEEK_V4_CONTEXT_TOKENS = 1_000_000;
export const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 384_000;

export type DeepSeekV4Lane = "flash" | "pro";

export interface DeepSeekV4ModelProfile {
  lane: DeepSeekV4Lane;
  legacyAlias: boolean;
  optimizedThinkingDefault: boolean;
  canonicalModel: typeof DEEPSEEK_V4_FLASH | typeof DEEPSEEK_V4_PRO;
}

/** Detects the official hosted DeepSeek API without trusting look-alike hosts. */
export function isOfficialDeepSeekApi(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "api.deepseek.com" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (url.port === "" || url.port === "443")
    );
  } catch {
    return false;
  }
}

/** Resolves official V4 models and their temporary legacy aliases. */
export function getDeepSeekV4ModelProfile(
  model: string,
): DeepSeekV4ModelProfile | undefined {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "");
  if (normalized === DEEPSEEK_V4_FLASH) {
    return {
      lane: "flash",
      legacyAlias: false,
      optimizedThinkingDefault: false,
      canonicalModel: DEEPSEEK_V4_FLASH,
    };
  }
  if (normalized === DEEPSEEK_V4_PRO) {
    return {
      lane: "pro",
      legacyAlias: false,
      optimizedThinkingDefault: true,
      canonicalModel: DEEPSEEK_V4_PRO,
    };
  }
  if (normalized === "deepseek-chat") {
    return {
      lane: "flash",
      legacyAlias: true,
      optimizedThinkingDefault: false,
      canonicalModel: DEEPSEEK_V4_FLASH,
    };
  }
  if (normalized === "deepseek-reasoner") {
    return {
      lane: "flash",
      legacyAlias: true,
      optimizedThinkingDefault: true,
      canonicalModel: DEEPSEEK_V4_FLASH,
    };
  }
  return undefined;
}

export function getDeepSeekReasoningEffort(
  budgetTokens = 4096,
): "high" | "max" {
  return budgetTokens >= 8192 ? "max" : "high";
}
