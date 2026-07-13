import { describe, expect, it } from "vitest";
import { stripAnsiCodes } from "./TerminalText.js";
import { createPromptState } from "./TuiPromptSession.js";
import { renderPromptScreen } from "./TuiPromptView.js";

describe("TuiPromptView", () => {
  it("renders password values without exposing their plaintext", () => {
    const output = stripAnsiCodes(
      renderPromptScreen(
        createPromptState({
          type: "password",
          message: "Secret",
          initialValue: "private-value",
        }),
        { columns: 80, rows: 24, isZh: false },
      ),
    );
    expect(output).toContain("*".repeat("private-value".length));
    expect(output).not.toContain("private-value");
  });
});
