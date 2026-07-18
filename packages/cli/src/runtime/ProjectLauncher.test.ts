import { EventEmitter } from "events";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchOrbitProject } from "./ProjectLauncher.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("launchOrbitProject", () => {
  it("creates a folder and launches an isolated WebUI process", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const project = join(root, "new-project");
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const launch = vi.fn(() => child);
    const registry = { register: vi.fn() };

    const launchedProject = launchOrbitProject(
      { action: "create", path: project },
      {
        entryPoint: "C:/orbit/index.js",
        executable: "node",
        launch: launch as never,
        registry,
      },
    );
    const canonicalProject = realpathSync(project);

    expect(launchedProject).toBe(canonicalProject);
    expect(launch).toHaveBeenCalledWith(
      "node",
      ["C:/orbit/index.js", "webui", "--cwd", canonicalProject],
      expect.objectContaining({
        cwd: canonicalProject,
        detached: true,
        stdio: "ignore",
      }),
    );
    expect(child.unref).toHaveBeenCalledOnce();
    expect(registry.register).toHaveBeenCalledWith(canonicalProject);
  });

  it("rejects missing existing projects and relative paths", () => {
    expect(() =>
      launchOrbitProject({ action: "open", path: "relative/project" }),
    ).toThrow("absolute");

    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    expect(() =>
      launchOrbitProject({ action: "open", path: join(root, "missing") }),
    ).toThrow("does not exist");
  });
});
