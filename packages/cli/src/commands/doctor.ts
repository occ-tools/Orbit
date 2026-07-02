import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import picocolors from "picocolors";
import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import { buildCacheDiagnostics } from "../runtime/CacheDiagnostics.js";
import {
  formatProviderBenchmarkSummary,
  readProviderBenchmarks,
} from "../runtime/ProviderBenchmarks.js";
import {
  formatProviderProbe,
  probeProviderCapabilities,
  readProviderProbeCache,
} from "../runtime/ProviderDiagnostics.js";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";

type DoctorExec = (
  command: string,
  options?: Record<string, unknown>,
) => string;

interface DoctorReportOptions {
  exec?: DoctorExec;
  env?: NodeJS.ProcessEnv;
  providerProbeText?: string;
  deepseek?: boolean;
}

function defaultExec(command: string, options: Record<string, unknown> = {}) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
  }) as string;
}

function commandOutput(
  exec: DoctorExec,
  command: string,
  cwd?: string,
): string | undefined {
  try {
    return exec(command, cwd ? { cwd } : undefined).trim();
  } catch {
    return undefined;
  }
}

function statusLine(ok: boolean, text: string, warn = false): string {
  if (ok) return picocolors.green(`✔ ${text}`);
  return warn ? picocolors.yellow(`⚠️ ${text}`) : picocolors.red(`✖ ${text}`);
}

function packageManager(cwd: string): string {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  if (existsSync(join(cwd, "package.json"))) return "npm";
  return "unknown";
}

function boolText(value: boolean): string {
  return value ? picocolors.green("on") : picocolors.yellow("off");
}

function providerLooksLikeDeepSeek(providerId: string, config: OrbitConfig) {
  const provider = config.providers[providerId];
  const haystack = [
    providerId,
    provider?.type,
    provider?.baseUrl,
    config.models.default,
    config.models.fast,
    config.models.planner,
    config.models.coder,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("deepseek");
}

function apiKeyLoaded(providerId: string, config: OrbitConfig) {
  const provider = config.providers[providerId];
  if (!provider) return false;
  try {
    return Boolean(provider.apiKey);
  } catch {
    return false;
  }
}

function allConfiguredModelNames(config: OrbitConfig): string[] {
  return Array.from(
    new Set(
      Object.values(config.models)
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function buildDeepSeekDoctorSection(
  cwd: string,
  config: OrbitConfig,
  providerProbeText?: string,
): string {
  const providerId = config.provider.default;
  const provider = config.providers[providerId];
  const models = allConfiguredModelNames(config);
  const deprecatedAliases = models.filter((model) =>
    /^(deepseek-chat|deepseek-reasoner)$/i.test(model),
  );
  const deepseekV4Models = models.filter((model) =>
    /deepseek-v4-(flash|pro)/i.test(model),
  );
  const benchmarks = readProviderBenchmarks(cwd).filter(
    (item) => item.providerId === providerId && models.includes(item.model),
  );
  const successfulBenchmarks = benchmarks.filter((item) => !item.error);
  const recentCacheHits = successfulBenchmarks
    .slice(0, 20)
    .filter((item) => item.cacheInputTokens >= 512);
  const avgCacheHit =
    recentCacheHits.length > 0
      ? recentCacheHits.reduce((sum, item) => sum + item.cacheHitRate, 0) /
        recentCacheHits.length
      : undefined;
  const latestFirstDelta = successfulBenchmarks.find(
    (item) => typeof item.firstDeltaMs === "number",
  )?.firstDeltaMs;
  const lines = ["", picocolors.bold("DeepSeek Official Alignment")];

  lines.push(
    statusLine(
      providerLooksLikeDeepSeek(providerId, config),
      "Default provider/model profile targets DeepSeek.",
      true,
    ),
  );
  lines.push(
    statusLine(
      Boolean(provider?.baseUrl?.includes("api.deepseek.com")),
      provider?.baseUrl
        ? `Base URL is ${provider.baseUrl}.`
        : "Provider base URL is not configured.",
      true,
    ),
  );
  lines.push(
    statusLine(
      deprecatedAliases.length === 0,
      deprecatedAliases.length === 0
        ? "No deprecated deepseek-chat/deepseek-reasoner aliases in configured model roles."
        : `Deprecated aliases configured: ${deprecatedAliases.join(", ")}. Prefer deepseek-v4-flash/pro.`,
      true,
    ),
  );
  lines.push(
    statusLine(
      deepseekV4Models.length > 0,
      deepseekV4Models.length > 0
        ? `DeepSeek V4 model roles: ${deepseekV4Models.join(", ")}.`
        : "No DeepSeek V4 flash/pro model role detected.",
      true,
    ),
  );
  lines.push(
    statusLine(
      provider?.type === "openai-compatible" ||
        provider?.type === "anthropic-compatible",
      `Provider type ${provider?.type || "missing"} supports DeepSeek-compatible routing.`,
      true,
    ),
  );
  lines.push(
    statusLine(
      Boolean(config.tools.webSearch.enabled),
      "Realtime web lookup is enabled for current facts; weather still uses Open-Meteo through web_search.",
      true,
    ),
  );
  lines.push(
    latestFirstDelta !== undefined
      ? statusLine(
          latestFirstDelta < 1200,
          `Recent first-token benchmark: ${latestFirstDelta}ms.`,
          true,
        )
      : picocolors.gray(
          "● No recent first-token benchmark. Run `orbit bench --cache-profile --repeat 3`.",
        ),
  );
  lines.push(
    avgCacheHit !== undefined
      ? statusLine(
          avgCacheHit >= 0.75,
          `Recent large-prompt cache hit average: ${Math.round(avgCacheHit * 100)}%.`,
          true,
        )
      : picocolors.gray(
          "● No large-prompt cache samples yet. Run `orbit bench --cache-profile --repeat 3`.",
        ),
  );
  if (providerProbeText) {
    lines.push(picocolors.gray(providerProbeText));
  }
  lines.push(
    picocolors.gray(
      "● Official-fit checks: streaming should be on, usage should be returned, repeated stable prefixes should warm cache, and user_id should remain stable per workspace.",
    ),
  );
  return lines.join("\n");
}

export function buildDoctorReport(
  cwd: string,
  config: OrbitConfig = ConfigLoader.loadSync(cwd),
  options: DoctorReportOptions = {},
): string {
  const exec = options.exec || defaultExec;
  const env = options.env || process.env;
  const lines: string[] = [];
  const defaultProvider = config.provider.default;
  const provider = config.providers[defaultProvider];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const gitVersion = commandOutput(exec, "git --version", cwd);
  const rgVersion = commandOutput(exec, "rg --version", cwd)?.split("\n")[0];
  const gitStatus = commandOutput(exec, "git status --short", cwd);
  const webSearch = config.tools.webSearch;
  const skills = config.skills;
  const mcpServers = Object.keys(config.mcpServers || {});
  const providerKeyName = provider?.apiKeyEnv || "configured provider key";
  const tavilyKeyName = webSearch.tavilyApiKeyEnv || "TAVILY_API_KEY";
  const searxngConfigured =
    webSearch.searxngUrls.length > 0 ||
    Boolean(env.ORBIT_SEARXNG_URL || env.SEARXNG_URL);
  const isDeepSeekProfile = providerLooksLikeDeepSeek(defaultProvider, config);

  lines.push(picocolors.bold("Orbit Diagnostics"));
  lines.push("");
  lines.push(picocolors.bold("Runtime"));
  lines.push(
    statusLine(
      nodeMajor >= 20,
      `Node.js ${process.version}${nodeMajor >= 20 ? " supported" : " requires v20+"}`,
    ),
  );
  lines.push(
    gitVersion
      ? picocolors.green(`✔ Git ${gitVersion.replace(/^git version\s+/i, "")}`)
      : picocolors.yellow(
          "⚠️ Git not found; checkpoint fallback will be filesystem-only.",
        ),
  );
  lines.push(
    rgVersion
      ? picocolors.green(`✔ Ripgrep ${rgVersion.replace(/^ripgrep\s+/i, "")}`)
      : picocolors.yellow(
          "⚠️ Ripgrep not found; code search will use slower fallback scanning.",
        ),
  );
  lines.push(`● Workspace: ${picocolors.cyan(cwd)}`);
  lines.push(`● Package manager: ${picocolors.cyan(packageManager(cwd))}`);
  if (gitStatus !== undefined) {
    lines.push(
      gitStatus
        ? picocolors.yellow("⚠️ Git workspace has local changes.")
        : picocolors.green("✔ Git workspace is clean."),
    );
  }

  lines.push("");
  lines.push(picocolors.bold("Models"));
  lines.push(`● Provider: ${picocolors.cyan(defaultProvider)}`);
  lines.push(
    provider
      ? picocolors.green(`✔ Provider type: ${provider.type}`)
      : picocolors.red(`✖ Provider config missing: ${defaultProvider}`),
  );
  if (provider?.baseUrl) {
    lines.push(`● Base URL: ${picocolors.cyan(provider.baseUrl)}`);
  }
  lines.push(
    statusLine(
      apiKeyLoaded(defaultProvider, config) || provider?.type === "ollama",
      provider?.type === "ollama"
        ? "API key not required for Ollama."
        : `API key loaded from ${providerKeyName}.`,
    ),
  );
  lines.push(
    statusLine(
      isDeepSeekProfile,
      isDeepSeekProfile
        ? "DeepSeek cache-first profile is active."
        : "Default provider is not DeepSeek; DeepSeek cache benefits may not apply.",
      true,
    ),
  );
  lines.push(
    `● Roles: default=${picocolors.cyan(config.models.default)}, fast=${picocolors.cyan(
      config.models.fast,
    )}, planner=${picocolors.cyan(config.models.planner)}, coder=${picocolors.cyan(
      config.models.coder,
    )}`,
  );
  if (options.providerProbeText) {
    lines.push(options.providerProbeText);
  } else {
    const cachedProbe = readProviderProbeCache(cwd).find(
      (item) =>
        item.providerId === defaultProvider &&
        item.model === config.models.default,
    );
    if (cachedProbe) {
      lines.push(picocolors.gray(formatProviderProbe(cachedProbe)));
    } else {
      lines.push(
        picocolors.gray(
          "● Provider probe: no cached result yet. Run `orbit doctor --probe` to test streaming and usage support.",
        ),
      );
    }
  }
  lines.push(
    formatProviderBenchmarkSummary(cwd, defaultProvider, config.models.default),
  );

  lines.push("");
  lines.push(picocolors.bold("Tools"));
  lines.push(
    `● Bash: ${boolText(config.tools.bash.enabled)} timeout=${config.tools.bash.timeoutMs}ms`,
  );
  lines.push(
    `● Web search: ${boolText(webSearch.enabled)} provider=${picocolors.cyan(
      webSearch.provider,
    )} maxResults=${webSearch.maxResults} timeout=${webSearch.timeoutMs}ms`,
  );
  lines.push(
    statusLine(
      webSearch.enabled,
      "Realtime lookup enabled; weather queries use direct Open-Meteo first.",
      true,
    ),
  );
  lines.push(
    statusLine(
      searxngConfigured ||
        Boolean(env[tavilyKeyName]) ||
        webSearch.provider !== "auto",
      `Search backend configured: searxng=${searxngConfigured ? "yes" : "no"}, tavilyKey=${
        env[tavilyKeyName] ? "yes" : "no"
      }, fallback=${webSearch.provider}.`,
      true,
    ),
  );
  lines.push(
    `● MCP: ${boolText(config.tools.mcp.enabled)} servers=${mcpServers.length}`,
  );

  lines.push("");
  lines.push(picocolors.bold("Skills"));
  lines.push(
    `● Skills: ${boolText(skills.enabled)} activation=${picocolors.cyan(
      skills.activation,
    )} maxActive=${skills.maxActive} maxBytes=${skills.maxSkillBytes} maxAutoBytes=${skills.maxAutoSkillBytes}`,
  );
  lines.push(
    `● Skill dirs: ${skills.directories.map((dir) => picocolors.cyan(dir)).join(", ")}`,
  );

  lines.push("");
  lines.push(picocolors.bold("Safety & Context"));
  lines.push(
    `● Mode: ${picocolors.cyan(config.permissions.mode)} writeApproval=${boolText(
      config.permissions.requireApprovalForWrite,
    )} bashApproval=${boolText(config.permissions.requireApprovalForBash)}`,
  );
  lines.push(
    `● Guards: dangerous=${boolText(config.permissions.blockDangerousCommands)} secrets=${boolText(
      config.permissions.protectSecrets,
    )}`,
  );
  lines.push(
    `● Context: maxFiles=${config.context.maxFilesToIndex} maxFile=${config.context.maxFileSizeKb}KB autoCompact=${boolText(
      config.context.autoCompact,
    )} threshold=${config.context.compactThreshold}`,
  );

  lines.push("");
  lines.push(picocolors.bold("DeepSeek Cache"));
  lines.push(buildCacheDiagnostics(cwd));
  if (options.deepseek) {
    lines.push(
      buildDeepSeekDoctorSection(cwd, config, options.providerProbeText),
    );
  }

  return lines.join("\n");
}

export async function runDoctor(
  cwd: string,
  options: { probe?: boolean; deepseek?: boolean } = {},
): Promise<void> {
  const config = ConfigLoader.loadSync(cwd);
  let providerProbeText: string | undefined;
  if (options.probe) {
    try {
      const provider = createProviderFromConfig(config);
      providerProbeText = formatProviderProbe(
        await probeProviderCapabilities(cwd, config, provider),
      );
    } catch (error: any) {
      providerProbeText = picocolors.red(
        `Provider probe failed: ${error?.message || String(error)}`,
      );
    }
  }
  console.log(
    buildDoctorReport(cwd, config, {
      providerProbeText,
      deepseek: !!options.deepseek,
    }),
  );
}
