import { readFileSync } from "node:fs";
import { z } from "zod";

const CliPackageManifestSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
      "expected a semantic version",
    ),
});

/** Read the version embedded in the installed CLI package. */
export function readCliVersion(): string {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];
  let lastError: unknown;
  for (const manifestUrl of candidates) {
    try {
      const manifest = CliPackageManifestSchema.parse(
        JSON.parse(readFileSync(manifestUrl, "utf8")) as unknown,
      );
      return manifest.version;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to read the Orbit CLI package version: ${detail}`, {
    cause: lastError,
  });
}
