import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("install-global", () => {
  it("runs npm link from the CLI package and verifies the global command", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "install-global.mjs"),
      "utf8",
    );

    expect(source).toContain(
      '[...npmArgumentPrefix, "link", "--no-audit", "--no-fund"]',
    );
    expect(source).toContain('[...npmArgumentPrefix, "prefix", "--global"]');
    expect(source).toContain('["/d", "/s", "/c", "npm.cmd"]');
    expect(source).toContain(
      "realpathSync(globalPackageDirectory) !== realpathSync(cliDirectory)",
    );
    expect(source).toContain("installedPackage.version !== cliPackage.version");
    expect(source).not.toContain("shell: true");
  });
});
