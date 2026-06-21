import { existsSync, readFileSync, readdirSync } from "fs";
import { basename, extname, join } from "path";
import { homedir } from "os";
import { parse } from "yaml";
import { z } from "zod";

const CommandMetadataSchema = z.object({
  description: z.string().max(240).optional(),
  argumentHint: z.string().max(120).optional(),
});

export interface CustomCommand {
  name: string;
  description: string;
  argumentHint?: string;
  template: string;
  source: "user" | "project";
  filePath: string;
}

const VALID_COMMAND_NAME = /^[a-z0-9][a-z0-9-_]{0,47}$/i;
const MAX_COMMAND_FILE_BYTES = 256 * 1024;

function parseCommandFile(
  filePath: string,
  source: CustomCommand["source"],
): CustomCommand | null {
  const commandName = basename(filePath, extname(filePath));
  if (!VALID_COMMAND_NAME.test(commandName)) return null;

  const raw = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_COMMAND_FILE_BYTES) return null;

  let metadata: z.infer<typeof CommandMetadataSchema> = {};
  let template = raw.trim();
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (frontmatter) {
    const parsed = CommandMetadataSchema.safeParse(parse(frontmatter[1]) || {});
    if (!parsed.success) return null;
    metadata = parsed.data;
    template = frontmatter[2].trim();
  }
  if (!template) return null;

  return {
    name: commandName.toLowerCase(),
    description:
      metadata.description || `Run the ${commandName} prompt workflow`,
    argumentHint: metadata.argumentHint,
    template,
    source,
    filePath,
  };
}

function loadDirectory(
  directory: string,
  source: CustomCommand["source"],
): CustomCommand[] {
  if (!existsSync(directory)) return [];
  const commands: CustomCommand[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") {
      continue;
    }
    try {
      const command = parseCommandFile(join(directory, entry.name), source);
      if (command) commands.push(command);
    } catch {
      // A malformed optional command should not prevent Orbit from starting.
    }
  }
  return commands;
}

export function loadCustomCommands(
  cwd: string,
  reservedNames: Iterable<string> = [],
): CustomCommand[] {
  const reserved = new Set(
    Array.from(reservedNames, (name) => name.replace(/^\//, "").toLowerCase()),
  );
  const merged = new Map<string, CustomCommand>();

  for (const command of loadDirectory(
    join(homedir(), ".orbit", "commands"),
    "user",
  )) {
    if (!reserved.has(command.name)) merged.set(command.name, command);
  }
  for (const command of loadDirectory(
    join(cwd, ".orbit", "commands"),
    "project",
  )) {
    if (!reserved.has(command.name)) merged.set(command.name, command);
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function expandCustomCommand(
  command: CustomCommand,
  rawArguments: string,
): string {
  const args = rawArguments.trim();
  const positional = args ? args.split(/\s+/) : [];
  let expanded = command.template
    .replace(/\$ARGUMENTS\b/g, args)
    .replace(/\{\{\s*args\s*\}\}/gi, args);

  for (let index = 1; index <= 9; index++) {
    expanded = expanded.replace(
      new RegExp(`\\$${index}\\b`, "g"),
      positional[index - 1] || "",
    );
  }

  if (
    args &&
    !/\$ARGUMENTS\b|\{\{\s*args\s*\}\}|\$[1-9]\b/i.test(command.template)
  ) {
    expanded += `\n\nAdditional user arguments:\n${args}`;
  }
  return expanded.trim();
}
