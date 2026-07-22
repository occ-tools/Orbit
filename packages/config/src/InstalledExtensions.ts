import { existsSync, lstatSync, readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join, relative, resolve } from "path";
import { z } from "zod";
import type { OrbitConfig } from "./schema.js";
import { loadOrbitExtensionManifest } from "./ExtensionManifest.js";

const InstalledExtensionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  trusted: z.boolean(),
  path: z.string(),
  manifestFile: z.string().min(1).max(4096).default("extension.yaml"),
});
const ExtensionRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  extensions: z.array(InstalledExtensionSchema).max(500).default([]),
});

/** Merge integrity-checked, explicitly trusted MCP contributions. */
export function applyInstalledExtensionContributions(
  source: OrbitConfig,
  homeDirectory: string,
): OrbitConfig {
  const registryPath = join(homeDirectory, ".orbit", "extensions.json");
  if (!existsSync(registryPath)) return source;
  let registry: unknown;
  try {
    registry = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return source;
  }
  const parsed = ExtensionRegistrySchema.safeParse(registry);
  if (!parsed.success) return source;

  const config = structuredClone(source);
  const extensionsRoot = resolve(homeDirectory, ".orbit", "extensions");
  for (const extension of parsed.data.extensions) {
    if (!extension.trusted) continue;
    const root = resolve(extension.path);
    const relation = relative(extensionsRoot, root);
    if (
      !relation ||
      relation.startsWith("..") ||
      resolve(root) === extensionsRoot
    )
      continue;
    if (!existsSync(root) || lstatSync(root).isSymbolicLink()) continue;
    if (hashDirectory(root) !== extension.digest) continue;
    try {
      const manifest = loadOrbitExtensionManifest(root, extension.manifestFile);
      if (manifest.id !== extension.id) continue;
      for (const [name, server] of Object.entries(
        manifest.contributes.mcpServers,
      )) {
        const key = `${extension.id}.${name}`;
        if (!config.mcpServers[key]) config.mcpServers[key] = server;
      }
    } catch {
      continue;
    }
  }
  if (Object.keys(config.mcpServers).length > 0)
    config.tools.mcp.enabled = true;
  return config;
}

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error("Symlinked extension entry.");
      hash.update(relative(root, path).replace(/\\/g, "/"));
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) hash.update(readFileSync(path));
      else throw new Error("Unsupported extension entry.");
    }
  };
  visit(root);
  return hash.digest("hex");
}
