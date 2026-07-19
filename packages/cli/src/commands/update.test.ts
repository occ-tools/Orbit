import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "./update.js";

describe("runUpdate", () => {
  it("reports an available update without mutating in check mode", async () => {
    const manager = createManager(true);
    const output: string[] = [];

    const result = await runUpdate(
      "0.1.6",
      { check: true },
      { manager, write: (text) => output.push(text) },
    );

    expect(result.installed).toBe(false);
    expect(manager.install).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("0.1.6");
    expect(output.join("\n")).toContain("0.2.0");
  });

  it("uses JSON as a non-destructive check unless --yes is explicit", async () => {
    const manager = createManager(true);
    const output: string[] = [];

    await runUpdate(
      "0.1.6",
      { json: true },
      { manager, interactive: false, write: (text) => output.push(text) },
    );

    expect(manager.install).not.toHaveBeenCalled();
    expect(JSON.parse(output[0])).toMatchObject({
      schemaVersion: 1,
      installed: false,
    });
  });

  it("installs the exact checked version after confirmation", async () => {
    const manager = createManager(true);
    const beforeInstall = vi.fn();
    const afterInstall = vi.fn();

    const result = await runUpdate(
      "0.1.6",
      {},
      {
        manager,
        interactive: true,
        confirm: async () => true,
        write: vi.fn(),
        beforeInstall,
        afterInstall,
      },
    );

    expect(result.installed).toBe(true);
    expect(manager.install).toHaveBeenCalledWith("0.2.0", true);
    expect(manager.readInstalledVersion).toHaveBeenCalledOnce();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(afterInstall).toHaveBeenCalledOnce();
  });

  it("rolls back when the installed version cannot be verified", async () => {
    const manager = createManager(true);
    manager.readInstalledVersion
      .mockReturnValueOnce("0.1.9")
      .mockReturnValueOnce("0.1.6");

    await expect(
      runUpdate("0.1.6", { yes: true }, { manager, write: vi.fn() }),
    ).rejects.toThrow("Orbit 0.1.6 was restored");
    expect(manager.install).toHaveBeenNthCalledWith(1, "0.2.0", true);
    expect(manager.install).toHaveBeenNthCalledWith(2, "0.1.6", true);
  });

  it("redacts credentials from install failures", async () => {
    const manager = createManager(true);
    manager.install
      .mockImplementationOnce(() => {
        throw new Error("Authorization: Bearer private-npm-token");
      })
      .mockImplementationOnce(() => undefined);
    manager.readInstalledVersion.mockReturnValue("0.1.6");

    const error = await runUpdate(
      "0.1.6",
      { yes: true },
      { manager, write: vi.fn() },
    ).catch((caught: unknown) => caught);

    expect(String(error)).not.toContain("private-npm-token");
    expect(String(error)).toContain("***REDACTED***");
  });

  it("does not install when already current", async () => {
    const manager = createManager(false);
    const result = await runUpdate(
      "0.1.6",
      { yes: true },
      { manager, write: vi.fn() },
    );

    expect(result.installed).toBe(false);
    expect(manager.install).not.toHaveBeenCalled();
  });
});

function createManager(updateAvailable: boolean) {
  return {
    check: vi.fn(() => ({
      currentVersion: "0.1.6",
      latestVersion: updateAvailable ? "0.2.0" : "0.1.6",
      updateAvailable,
    })),
    install: vi.fn(),
    readInstalledVersion: vi.fn(() => (updateAvailable ? "0.2.0" : "0.1.6")),
  };
}
