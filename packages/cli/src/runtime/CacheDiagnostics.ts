import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import picocolors from "picocolors";

interface CacheTelemetrySample {
  recordedAt: string;
  inputTokens: number;
  hitTokens: number;
  missTokens: number;
  hitRate: number;
  degraded: boolean;
}

interface CacheSlabMetadata {
  hash?: string;
  model?: string;
  tokenEstimate?: number;
  lastPrimedAt?: string;
  telemetry?: CacheTelemetrySample[];
}

function readMetadata(filePath: string): CacheSlabMetadata | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as CacheSlabMetadata;
  } catch {
    return undefined;
  }
}

export function buildCacheDiagnostics(cwd: string): string {
  const dir = join(cwd, ".orbit", "cache-slabs");
  if (!existsSync(dir)) {
    return picocolors.gray(
      "● No cache slabs found yet. Stable project context will be primed after the next DeepSeek request.",
    );
  }

  const slabs = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readMetadata(join(dir, file)))
    .filter((item): item is CacheSlabMetadata => Boolean(item))
    .sort((a, b) =>
      String(b.lastPrimedAt || "").localeCompare(String(a.lastPrimedAt || "")),
    )
    .slice(0, 5);

  if (slabs.length === 0) {
    return picocolors.gray(
      "● No readable cache slab metadata found. Remove stale .orbit/cache-slabs entries if this persists.",
    );
  }

  const lines: string[] = [];
  for (const slab of slabs) {
    const samples = (slab.telemetry || []).slice(-5);
    const latest = samples.at(-1);
    const trend =
      samples.length > 1
        ? samples.reduce((sum, sample) => sum + sample.hitRate, 0) /
          samples.length
        : latest?.hitRate;
    const degraded = samples.some((sample) => sample.degraded);
    const label = `${slab.hash || "unknown"} model=${slab.model || "unknown"} stable=${slab.tokenEstimate || 0}t`;

    if (!latest) {
      lines.push(
        picocolors.gray(
          `● ${label}: primed ${slab.lastPrimedAt || "unknown"}, no live telemetry yet.`,
        ),
      );
      continue;
    }

    const color =
      degraded || latest.hitRate < 0.55 ? picocolors.yellow : picocolors.green;
    lines.push(
      color(
        `● ${label}: latest ${Math.round(latest.hitRate * 100)}% hit, recent avg ${Math.round(
          (trend || 0) * 100,
        )}% (${latest.hitTokens}/${latest.inputTokens} tokens).`,
      ),
    );
  }

  return lines.join("\n");
}
