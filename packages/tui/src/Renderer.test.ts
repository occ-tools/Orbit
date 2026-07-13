import { afterEach, describe, expect, it, vi } from "vitest";
import { Renderer } from "./Renderer.js";

describe("Renderer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats thought blocks without writing to stdout", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const output = Renderer.formatThought("first line\nsecond line");

    expect(output).toContain("Orbit Agent Thinking:");
    expect(output).toContain("first line");
    expect(output).toContain("second line");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns an empty string for blank thoughts", () => {
    expect(Renderer.formatThought("  \n ")).toBe("");
  });
});
