import { describe, expect, it } from "vitest";
import {
  collectProductionVersions,
  failingAdvisories,
} from "./audit-production.mjs";

describe("production advisory audit", () => {
  it("walks only production and optional dependency edges", () => {
    const versions = collectProductionVersions({
      importers: {
        ".": {
          dependencies: { alpha: { version: "1.0.0" } },
          devDependencies: { devOnly: { version: "9.0.0" } },
        },
        "packages/app": {
          dependencies: { local: { version: "link:../local" } },
          optionalDependencies: { optional: "3.0.0" },
        },
      },
      snapshots: {
        "alpha@1.0.0": { dependencies: { child: "2.0.0" } },
        "child@2.0.0": {},
        "optional@3.0.0": {},
        "devOnly@9.0.0": {},
      },
    });

    expect(versions).toEqual({
      alpha: ["1.0.0"],
      child: ["2.0.0"],
      optional: ["3.0.0"],
    });
  });

  it("blocks only advisories at or above the configured severity", () => {
    const failures = failingAdvisories(
      {
        alpha: [
          { title: "moderate issue", severity: "moderate" },
          { title: "critical issue", severity: "critical" },
        ],
      },
      "high",
    );

    expect(failures).toEqual([
      expect.objectContaining({
        packageName: "alpha",
        severity: "critical",
      }),
    ]);
  });
});
