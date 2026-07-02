type ProviderConfigLike = {
  type?: string;
  models?: string[];
};

type ConfigLike = {
  provider?: { default?: string };
  providers?: Record<string, ProviderConfigLike | undefined>;
};

const DEEPSEEK_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-ai/DeepSeek-V4-Flash-DSpark",
  "deepseek-ai/DeepSeek-V4-Pro-DSpark",
];

export const DEEPSEEK_LEGACY_ALIAS_DEPRECATION = "2026-07-24T15:59:00Z";

const DEEPSEEK_LEGACY_ALIAS_REPLACEMENTS: Record<string, string> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
};

const OPENAI_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];

const ANTHROPIC_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

const OLLAMA_MODELS = ["qwen2.5-coder:7b", "qwen2.5-coder:1.5b", "llama3"];

function uniqueModels(models: string[]): string[] {
  return Array.from(new Set(models.map((m) => m.trim()).filter(Boolean)));
}

export function getProviderModelCandidates(
  config: ConfigLike | undefined,
  providerId = config?.provider?.default,
): string[] {
  const providerConfig = providerId
    ? config?.providers?.[providerId]
    : undefined;
  const configuredModels = Array.isArray(providerConfig?.models)
    ? uniqueModels(providerConfig.models)
    : [];
  if (configuredModels.length > 0) {
    return configuredModels;
  }

  const providerType = providerConfig?.type;
  if (providerType === "anthropic" || providerType === "anthropic-compatible") {
    return ANTHROPIC_MODELS;
  }
  if (providerType === "openai") {
    return OPENAI_MODELS;
  }
  if (providerType === "openai-compatible") {
    return providerId?.toLowerCase().includes("deepseek")
      ? DEEPSEEK_MODELS
      : uniqueModels([...OPENAI_MODELS, ...DEEPSEEK_MODELS]);
  }
  if (providerType === "ollama") {
    return OLLAMA_MODELS;
  }
  return uniqueModels([
    ...DEEPSEEK_MODELS,
    ...OPENAI_MODELS,
    ...ANTHROPIC_MODELS,
  ]);
}

export function isDeprecatedDeepSeekAlias(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    DEEPSEEK_LEGACY_ALIAS_REPLACEMENTS,
    model.trim().toLowerCase(),
  );
}

export function getDeepSeekAliasReplacement(model: string): string | undefined {
  return DEEPSEEK_LEGACY_ALIAS_REPLACEMENTS[model.trim().toLowerCase()];
}

export function describeDeprecatedDeepSeekAliases(models: string[]): string {
  const deprecated = uniqueModels(models).filter(isDeprecatedDeepSeekAlias);
  if (deprecated.length === 0) {
    return "No deprecated deepseek-chat/deepseek-reasoner aliases in configured model roles.";
  }

  const replacements = deprecated
    .map((model) => `${model} -> ${getDeepSeekAliasReplacement(model)}`)
    .join(", ");
  return `Deprecated DeepSeek aliases configured: ${replacements}. They are scheduled for removal after ${DEEPSEEK_LEGACY_ALIAS_DEPRECATION}; prefer deepseek-v4-flash/pro.`;
}

export function formatModelOptionLabel(model: string): string {
  const lower = model.toLowerCase();
  const replacement = getDeepSeekAliasReplacement(model);
  if (replacement) {
    return `${model} (deprecated -> ${replacement})`;
  }
  if (lower.includes("deepseek-v4-flash") || lower.includes("flash")) {
    return `${model} (fast / flash)`;
  }
  if (lower.includes("deepseek-v4-pro") || lower.includes("pro")) {
    return `${model} (reasoning / pro)`;
  }
  if (lower.includes("gpt-5.5") || lower.includes("gpt-5.4")) {
    return `${model} (OpenAI)`;
  }
  if (lower.includes("claude")) {
    return `${model} (Anthropic)`;
  }
  return model;
}
