import readline from "readline";
import picocolors from "picocolors";
import { z } from "zod";
import { UpdateManager, type UpdateCheck } from "../runtime/UpdateManager.js";

const UpdateCommandOptionsSchema = z
  .object({
    check: z.boolean().default(false),
    yes: z.boolean().default(false),
    json: z.boolean().default(false),
  })
  .strict();

export interface UpdateCommandOptions {
  check?: boolean;
  yes?: boolean;
  json?: boolean;
}

export interface UpdateCommandDependencies {
  manager?: Pick<UpdateManager, "check" | "install">;
  interactive?: boolean;
  confirm?: (prompt: string) => Promise<boolean>;
  write?: (text: string) => void;
  beforeInstall?: () => void;
  afterInstall?: () => void;
}

export interface UpdateCommandResult {
  check: UpdateCheck;
  installed: boolean;
}

/** Check the published npm version and explicitly install an available update. */
export async function runUpdate(
  currentVersion: string,
  rawOptions: UpdateCommandOptions,
  dependencies: UpdateCommandDependencies = {},
): Promise<UpdateCommandResult> {
  const options = UpdateCommandOptionsSchema.parse(rawOptions);
  const manager = dependencies.manager ?? new UpdateManager();
  const write = dependencies.write ?? ((text: string) => console.log(text));
  const check = manager.check(currentVersion);

  if (!check.updateAvailable) {
    const result = { check, installed: false };
    write(
      options.json
        ? JSON.stringify({ schemaVersion: 1, ...result })
        : picocolors.green(
            `✔ Orbit ${check.currentVersion} is already up to date.`,
          ),
    );
    return result;
  }

  if (options.check || (options.json && !options.yes)) {
    const result = { check, installed: false };
    write(
      options.json
        ? JSON.stringify({ schemaVersion: 1, ...result })
        : `${picocolors.yellow("● Update available:")} ${check.currentVersion} → ${check.latestVersion}\n  Run ${picocolors.cyan("orbit update --yes")} to install it.`,
    );
    return result;
  }

  let confirmed = options.yes;
  if (!confirmed) {
    const interactive =
      dependencies.interactive ?? Boolean(process.stdin.isTTY);
    if (!interactive) {
      throw new Error(
        "Updating requires an interactive confirmation or the explicit --yes flag.",
      );
    }
    const confirm = dependencies.confirm ?? confirmUpdate;
    confirmed = await confirm(
      `Update Orbit ${check.currentVersion} → ${check.latestVersion}? [y/N] `,
    );
  }

  if (!confirmed) {
    write(picocolors.yellow("⚠ Update cancelled."));
    return { check, installed: false };
  }

  dependencies.beforeInstall?.();
  try {
    manager.install(check.latestVersion, !options.json);
  } finally {
    dependencies.afterInstall?.();
  }
  const result = { check, installed: true };
  write(
    options.json
      ? JSON.stringify({ schemaVersion: 1, ...result })
      : picocolors.green(
          `✔ Orbit ${check.latestVersion} installed. Restart Orbit to use the new version.`,
        ),
  );
  return result;
}

async function confirmUpdate(prompt: string): Promise<boolean> {
  const interfaceInstance = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) =>
      interfaceInstance.question(prompt, resolve),
    );
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    interfaceInstance.close();
  }
}
