import { readFileSync } from "node:fs";
import { z } from "zod";

const RuntimePackageManifestSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
});

/**
 * Read the package version adjacent to a runtime module.
 *
 * Bundled consumers intentionally resolve their own package manifest. For
 * example, MCP reports its package version when used independently and the CLI
 * version when bundled into the published Orbit executable.
 */
export function readRuntimePackageVersion(moduleUrl: string | URL): string {
  const manifestUrl = new URL("../package.json", moduleUrl);
  try {
    const manifest = RuntimePackageManifestSchema.parse(
      JSON.parse(readFileSync(manifestUrl, "utf8")) as unknown,
    );
    return manifest.version;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read the Orbit package version: ${detail}`, {
      cause: error,
    });
  }
}
