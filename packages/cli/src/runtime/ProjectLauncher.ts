import { spawn } from "child_process";
import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { isAbsolute, parse, resolve } from "path";
import type { WebUiProjectAction } from "./webui/WebUiContracts.js";
import { ProjectRegistry } from "@orbit-build/session";

export interface ProjectLaunchOptions {
  entryPoint?: string;
  executable?: string;
  launch?: typeof spawn;
  registry?: Pick<ProjectRegistry, "register">;
}

/** Validate a requested project directory and launch an isolated Orbit WebUI. */
export function launchOrbitProject(
  request: Extract<WebUiProjectAction, { action: "open" | "create" }>,
  options: ProjectLaunchOptions = {},
): string {
  if (!isAbsolute(request.path)) {
    throw new Error("Enter an absolute project folder path.");
  }
  const requestedPath = resolve(request.path);
  if (requestedPath === parse(requestedPath).root) {
    throw new Error("A filesystem root cannot be opened as an Orbit project.");
  }
  if (!existsSync(requestedPath)) {
    if (request.action !== "create") {
      throw new Error("Project folder does not exist.");
    }
    mkdirSync(requestedPath, { recursive: true });
  }
  if (!statSync(requestedPath).isDirectory()) {
    throw new Error("Project path must point to a directory.");
  }

  const projectPath = realpathSync(requestedPath);
  (options.registry || new ProjectRegistry()).register(projectPath);
  const entryPoint = options.entryPoint || process.argv[1];
  if (!entryPoint) throw new Error("Orbit CLI entry point is unavailable.");
  const launch = options.launch || spawn;
  const child = launch(
    options.executable || process.execPath,
    [entryPoint, "webui", "--cwd", projectPath],
    {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.on("error", () => {});
  child.unref();
  return projectPath;
}
