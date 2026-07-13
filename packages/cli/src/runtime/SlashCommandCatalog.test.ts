import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLASH_COMMANDS,
  buildSlashCommandHelp,
} from "./SlashCommandCatalog.js";

const stripAnsi = (value: string): string =>
  value.replace(/\u001b\[[0-9;]*m/g, "");

describe("SlashCommandCatalog", () => {
  it("keeps the Web UI command reserved", () => {
    expect(BUILTIN_SLASH_COMMANDS).toContain("/webui");
    expect(new Set(BUILTIN_SLASH_COMMANDS).size).toBe(
      BUILTIN_SLASH_COMMANDS.length,
    );
  });

  it("renders complete localized help", () => {
    const english = stripAnsi(buildSlashCommandHelp(false));
    const chinese = stripAnsi(buildSlashCommandHelp(true));

    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(english).toContain(command);
      expect(chinese).toContain(command);
    }
    expect(english).toContain("Context Management");
    expect(chinese).toContain("上下文管理");
  });
});
