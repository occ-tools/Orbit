import { describe, expect, it, vi } from "vitest";
import { selectOrbitProjectFolder } from "./ProjectFolderPicker.js";

describe("selectOrbitProjectFolder", () => {
  it("uses the native Windows folder dialog and returns its path", async () => {
    const run = vi.fn(async () => ({
      stdout: "C:\\work\\orbit-project\r\n",
    }));

    await expect(
      selectOrbitProjectFolder({ platform: "win32", run }),
    ).resolves.toBe("C:\\work\\orbit-project");
    expect(run).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-STA", "-Command"]),
    );
  });

  it("treats a cancelled Linux picker as a non-error", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("cancelled"), { code: 1 });
    });

    await expect(
      selectOrbitProjectFolder({ platform: "linux", run }),
    ).resolves.toBeNull();
  });

  it("provides a manual-path fallback message when no picker exists", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    await expect(
      selectOrbitProjectFolder({ platform: "linux", run }),
    ).rejects.toThrow("enter the path manually");
  });
});
