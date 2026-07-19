import {
  loadOrbitExtensionManifest,
  type OrbitExtensionManifest,
} from "@orbit-build/config";
import picocolors from "picocolors";

export function validateExtension(
  cwd: string,
  manifestPath: string,
  options: { json?: boolean } = {},
): OrbitExtensionManifest {
  const manifest = loadOrbitExtensionManifest(cwd, manifestPath);
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return manifest;
  }
  const contributionCount = Object.values(manifest.contributes).reduce(
    (total, contribution) =>
      total +
      (Array.isArray(contribution)
        ? contribution.length
        : Object.keys(contribution).length),
    0,
  );
  console.log(
    picocolors.green(
      `✔ Extension manifest is valid: ${manifest.displayName} ${manifest.version}`,
    ),
  );
  console.log(
    picocolors.gray(
      `  ${manifest.id} · ${contributionCount} contribution(s) · process=${manifest.permissions.process}`,
    ),
  );
  return manifest;
}
