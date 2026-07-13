import { describe, expect, it } from "vitest";

import { WEB_UI_STYLES } from "./WebUiStyles.js";

describe("WEB_UI_STYLES", () => {
  it("composes visual regions in stable cascade order", () => {
    const orderedBoundaries = [
      ":root {",
      ".app-shell {",
      ".conversation {",
      ".composer-dock {",
      ".inspector {",
      ".toast-region {",
      "@media (max-width: 980px) {",
      "@media (prefers-reduced-motion: reduce) {",
    ];

    let previousIndex = -1;
    for (const boundary of orderedBoundaries) {
      const currentIndex = WEB_UI_STYLES.indexOf(boundary);
      expect(currentIndex, `missing CSS boundary: ${boundary}`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = currentIndex;
    }
  });

  it("produces a complete stylesheet without interpolation artifacts", () => {
    const openingBraces = WEB_UI_STYLES.match(/{/g)?.length ?? 0;
    const closingBraces = WEB_UI_STYLES.match(/}/g)?.length ?? 0;

    expect(WEB_UI_STYLES).not.toContain("undefined");
    expect(openingBraces).toBeGreaterThan(100);
    expect(closingBraces).toBe(openingBraces);
  });
});
