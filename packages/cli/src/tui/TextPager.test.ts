import { afterEach, describe, expect, it, vi } from "vitest";
import { pageText } from "./TextPager.js";

describe("pageText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints short text without taking over stdin", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resume = vi.spyOn(process.stdin, "resume");

    await pageText("first\nsecond");

    expect(log).toHaveBeenCalledWith("first\nsecond");
    expect(resume).not.toHaveBeenCalled();
  });
});
