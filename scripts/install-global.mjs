import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliDirectory = join(repositoryRoot, "packages", "cli");
const cliPackage = JSON.parse(
  readFileSync(join(cliDirectory, "package.json"), "utf8"),
);
const npmCommand =
  process.platform === "win32"
    ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
    : "npm";
const npmArgumentPrefix =
  process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd"] : [];

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}.`,
    );
  }
  return result.stdout.trim();
}

run(
  npmCommand,
  [...npmArgumentPrefix, "link", "--no-audit", "--no-fund"],
  cliDirectory,
);
const globalPrefix = run(
  npmCommand,
  [...npmArgumentPrefix, "prefix", "--global"],
  repositoryRoot,
);
const globalPackageDirectory =
  process.platform === "win32"
    ? join(globalPrefix, "node_modules", "@orbit-build", "cli")
    : join(globalPrefix, "lib", "node_modules", "@orbit-build", "cli");
const globalBin =
  process.platform === "win32"
    ? join(globalPrefix, "orbit.cmd")
    : join(globalPrefix, "bin", "orbit");

if (
  !existsSync(globalPackageDirectory) ||
  realpathSync(globalPackageDirectory) !== realpathSync(cliDirectory)
) {
  throw new Error(
    `Global Orbit link verification failed: ${globalPackageDirectory} does not target packages/cli.`,
  );
}
if (!existsSync(globalBin)) {
  throw new Error(`Global Orbit executable was not created: ${globalBin}.`);
}
const installedPackage = JSON.parse(
  readFileSync(join(globalPackageDirectory, "package.json"), "utf8"),
);
if (installedPackage.version !== cliPackage.version) {
  throw new Error(
    `Global Orbit version verification failed: expected ${cliPackage.version}, received ${installedPackage.version || "unknown"}.`,
  );
}

console.log(
  `✔ Linked global orbit to packages/cli and verified ${cliPackage.version}.`,
);
