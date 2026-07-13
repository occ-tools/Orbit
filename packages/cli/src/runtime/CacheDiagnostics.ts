import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import picocolors from "picocolors";
import { z } from "zod";

const CacheTelemetrySampleSchema = z
  .object({
    recordedAt: z.string(),
    inputTokens: z.number().nonnegative(),
    hitTokens: z.number().nonnegative(),
    missTokens: z.number().nonnegative(),
    hitRate: z.number().min(0).max(1),
    degraded: z.boolean(),
  })
  .passthrough();

const CacheSlabMetadataSchema = z
  .object({
    hash: z.string().optional(),
    model: z.string().optional(),
    tokenEstimate: z.number().nonnegative().optional(),
    /** Read-only compatibility with cache metadata from pre-V4 releases. */
    lastPrimedAt: z.string().optional(),
    telemetry: z.array(CacheTelemetrySampleSchema).optional(),
  })
  .passthrough();

type CacheSlabMetadata = z.infer<typeof CacheSlabMetadataSchema>;

function readMetadata(filePath: string): CacheSlabMetadata | undefined {
  try {
    const parsed = CacheSlabMetadataSchema.safeParse(
      JSON.parse(readFileSync(filePath, "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function latestObservation(metadata: CacheSlabMetadata): string {
  return metadata.telemetry?.at(-1)?.recordedAt || metadata.lastPrimedAt || "";
}

export function buildCacheDiagnostics(cwd: string): string {
  const dir = join(cwd, ".orbit", "cache-slabs");
  if (!existsSync(dir)) {
    return picocolors.gray(
      "● No cache telemetry yet. It will appear after a completed DeepSeek request.",
    );
  }

  const slabs = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readMetadata(join(dir, file)))
    .filter((item): item is CacheSlabMetadata => Boolean(item))
    .sort((a, b) => latestObservation(b).localeCompare(latestObservation(a)))
    .slice(0, 5);

  if (slabs.length === 0) {
    return picocolors.gray(
      "● No readable cache slab metadata found. Remove stale .orbit/cache-slabs entries if this persists.",
    );
  }

  const lines: string[] = [];
  if (slabs.length > 1) {
    const latest = slabs[0];
    const previous = slabs[1];
    const tokenDelta =
      (latest.tokenEstimate || 0) - (previous.tokenEstimate || 0);
    const tokenDeltaText =
      tokenDelta === 0 ? "0t" : `${tokenDelta > 0 ? "+" : ""}${tokenDelta}t`;
    const sameHash =
      Boolean(latest.hash && previous.hash) && latest.hash === previous.hash;
    lines.push(
      picocolors.gray(
        `● Cache slab churn: ${slabs.length} retained, latest vs previous stable delta ${tokenDeltaText}, hash ${sameHash ? "unchanged" : "changed"}.`,
      ),
    );
  }
  for (const slab of slabs) {
    const samples = (slab.telemetry || []).slice(-5);
    const latest = samples.at(-1);
    const trend =
      samples.length > 1
        ? samples.reduce((sum, sample) => sum + sample.hitRate, 0) /
          samples.length
        : latest?.hitRate;
    // A cold baseline must not keep the slab yellow after later requests warm.
    const degraded = latest?.degraded ?? false;
    const label = `${slab.hash || "unknown"} model=${slab.model || "unknown"} stable=${slab.tokenEstimate || 0}t`;

    if (!latest) {
      lines.push(
        picocolors.gray(
          `● ${label}: no request telemetry yet${slab.lastPrimedAt ? ` (legacy metadata ${slab.lastPrimedAt})` : ""}.`,
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
