import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { estimateTokenCount } from "@orbit-build/shared";
import { ContextPack } from "@orbit-build/context-engine";

export interface PromptCacheSlabInput {
  cwd: string;
  model: string;
  baseSystemPrompt: string;
  toolsPrompt: string;
  repoMapText: string;
  contextPack: ContextPack;
}

export interface PromptCacheSlab {
  hash: string;
  model: string;
  text: string;
  tokenEstimate: number;
  path: string;
  lastPrimedAt?: string;
}

export interface PromptCacheTelemetrySample {
  recordedAt: string;
  inputTokens: number;
  hitTokens: number;
  missTokens: number;
  hitRate: number;
  degraded: boolean;
}

interface PromptCacheSlabMetadata {
  hash?: string;
  model?: string;
  tokenEstimate?: number;
  lastPrimedAt?: string;
  telemetry?: PromptCacheTelemetrySample[];
}

export class PromptCacheSlabBuilder {
  public static build(input: PromptCacheSlabInput): PromptCacheSlab {
    const stableText = this.buildStableText(input);
    const hash = createHash("sha256").update(stableText).digest("hex");
    const slabPath = join(
      input.cwd,
      ".orbit",
      "cache-slabs",
      `${hash.slice(0, 24)}.json`,
    );

    const existing = this.readMetadata(slabPath);
    const lastPrimedAt =
      existing?.hash === hash && typeof existing.lastPrimedAt === "string"
        ? existing.lastPrimedAt
        : undefined;

    const slab: PromptCacheSlab = {
      hash,
      model: input.model,
      text: stableText,
      tokenEstimate: estimateTokenCount(stableText),
      path: slabPath,
      lastPrimedAt,
    };
    this.save(slab);
    return slab;
  }

  public static markPrimed(
    slab: PromptCacheSlab,
    date = new Date(),
  ): PromptCacheSlab {
    const updated = {
      ...slab,
      lastPrimedAt: date.toISOString(),
    };
    this.save(updated);
    return updated;
  }

  public static recordTelemetry(
    slab: PromptCacheSlab,
    sample: Omit<PromptCacheTelemetrySample, "recordedAt">,
    date = new Date(),
  ): void {
    const existing = this.readMetadata(slab.path);
    const telemetry = [
      ...(existing?.telemetry || []),
      {
        recordedAt: date.toISOString(),
        ...sample,
      },
    ].slice(-20);
    this.save(slab, telemetry);
  }

  public static buildDiagnostics(cwd: string): string {
    const dir = join(cwd, ".orbit", "cache-slabs");
    if (!existsSync(dir)) {
      return [
        "Cache diagnostics:",
        "- No cache slab metadata found yet.",
        "- Run at least one DeepSeek request to create a stable slab.",
      ].join("\n");
    }

    const slabs = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => this.readMetadata(join(dir, file)))
      .filter((meta): meta is PromptCacheSlabMetadata => Boolean(meta?.hash))
      .sort((a, b) => {
        const aTime = Date.parse(
          a.telemetry?.at(-1)?.recordedAt || a.lastPrimedAt || "",
        );
        const bTime = Date.parse(
          b.telemetry?.at(-1)?.recordedAt || b.lastPrimedAt || "",
        );
        return (
          (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0)
        );
      });

    if (slabs.length === 0) {
      return "Cache diagnostics:\n- No readable cache slab metadata found.";
    }

    const lines = ["Cache diagnostics:"];
    for (const slab of slabs.slice(0, 5)) {
      const samples = slab.telemetry || [];
      const recent = samples.at(-1);
      const avgHit =
        samples.length > 0
          ? samples.reduce((sum, item) => sum + item.hitRate, 0) /
            samples.length
          : undefined;
      lines.push(
        `- slab ${String(slab.hash).slice(0, 8)} model=${slab.model || "unknown"} tokens=${slab.tokenEstimate || 0} primed=${slab.lastPrimedAt || "never"}`,
      );
      if (recent) {
        lines.push(
          `  recent hit=${Math.round(recent.hitRate * 100)}% (${recent.hitTokens}/${recent.inputTokens}) miss=${recent.missTokens} degraded=${recent.degraded ? "yes" : "no"} at=${recent.recordedAt}`,
        );
      }
      if (avgHit !== undefined) {
        lines.push(
          `  trend samples=${samples.length} avgHit=${Math.round(avgHit * 100)}%`,
        );
      }
    }
    return lines.join("\n");
  }

  private static save(
    slab: PromptCacheSlab,
    telemetry?: PromptCacheTelemetrySample[],
  ): void {
    try {
      const dir = dirname(slab.path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const existing = this.readMetadata(slab.path);
      const tmpPath = `${slab.path}.tmp`;
      writeFileSync(
        tmpPath,
        JSON.stringify(
          {
            hash: slab.hash,
            model: slab.model,
            tokenEstimate: slab.tokenEstimate,
            lastPrimedAt: slab.lastPrimedAt,
            telemetry: telemetry || existing?.telemetry || [],
          },
          null,
          2,
        ),
        "utf8",
      );
      renameSync(tmpPath, slab.path);
    } catch {
      // Cache metadata must never block agent execution.
    }
  }

  private static readMetadata(
    path: string,
  ): PromptCacheSlabMetadata | undefined {
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return undefined;
    }
  }

  private static buildStableText(input: PromptCacheSlabInput): string {
    const ctx = input.contextPack;
    const sortedLanguages = [...ctx.projectIndex.detectedLanguages].sort();
    const sortedFrameworks = [...ctx.projectIndex.frameworks].sort();
    const sortedEntrypoints = [...ctx.projectIndex.entrypoints].sort();
    const skillsIndex = (ctx.skillsIndex || [])
      .map((skill) => {
        const description = skill.description
          ? ` - ${skill.description.replace(/\s+/g, " ").trim()}`
          : "";
        return `- ${skill.name}${description}`;
      })
      .join("\n");

    const stableWorkspace = [
      "### DeepSeek Cache Slab",
      `Model lane: ${input.model}`,
      "Cache policy: Keep everything above VOLATILE_CONTEXT byte-stable across turns.",
      "",
      "### Workspace Stable Profile",
      `Language profile: ${sortedLanguages.join(", ")}`,
      `Framework profile: ${sortedFrameworks.join(", ") || "None"}`,
      `Entrypoints: ${sortedEntrypoints.join(", ") || "None"}`,
      `PM: ${ctx.projectIndex.packageManager || "None"}`,
      skillsIndex ? `\n### Available Skills\n${skillsIndex}` : "",
      ctx.projectInstructions
        ? `\n### Project Instructions\n${ctx.projectInstructions}`
        : "",
      input.repoMapText ? `\n### Stable Repo Map\n${input.repoMapText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return [
      input.baseSystemPrompt.trimEnd(),
      input.toolsPrompt.trimEnd(),
      stableWorkspace.trimEnd(),
      "<!-- VOLATILE_CONTEXT -->",
    ].join("\n\n");
  }
}
