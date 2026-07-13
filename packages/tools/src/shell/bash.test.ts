import { describe, expect, it } from "vitest";
import { BashTool } from "./bash.js";

describe("BashTool", () => {
  it("reports a non-zero exit code as a failed tool result", async () => {
    const result = await new BashTool().execute(
      { command: 'node -e "process.exit(7)"' },
      { cwd: process.cwd(), sessionId: "test-session" },
    );

    expect(result.ok).toBe(false);
    expect(result.data?.exitCode).toBe(7);
    expect(result.error).toContain("non-zero status 7");
  });
});
