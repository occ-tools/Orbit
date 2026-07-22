import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join, relative } from "path";
import { DEFAULT_CONFIG } from "./defaults.js";
import { applyInstalledExtensionContributions } from "./InstalledExtensions.js";

describe("installed extension contributions", () => {
  let home: string;
  let extensionRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "orbit-installed-extension-"));
    extensionRoot = join(home, ".orbit", "extensions", "com.example.docs");
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.docs",
        "displayName: Docs",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.0",
        "permissions:",
        "  network: [docs.example.com]",
        "contributes:",
        "  mcpServers:",
        "    docs:",
        "      transport: streamable-http",
        "      url: https://docs.example.com/mcp",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("loads trusted MCP contributions only while their digest matches", () => {
    const registryPath = join(home, ".orbit", "extensions.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: "com.example.docs",
            digest: hashDirectory(extensionRoot),
            trusted: true,
            path: extensionRoot,
            manifestFile: "extension.yaml",
          },
        ],
      }),
    );

    const loaded = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(loaded.tools.mcp.enabled).toBe(true);
    expect(loaded.mcpServers["com.example.docs.docs"]).toMatchObject({
      transport: "streamable-http",
      url: "https://docs.example.com/mcp",
    });

    writeFileSync(join(extensionRoot, "tampered.txt"), "tampered");
    const rejected = applyInstalledExtensionContributions(
      structuredClone(DEFAULT_CONFIG),
      home,
    );
    expect(rejected.mcpServers).toEqual({});
  });
});

function hashDirectory(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      hash.update(relative(root, path).replace(/\\/g, "/"));
      if (stats.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
}
