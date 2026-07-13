import { describe, expect, it } from "vitest";

import { WEB_UI_CLIENT_SCRIPT } from "./WebUiClient.js";
import { WEB_UI_CLIENT_BINDINGS_SCRIPT } from "./WebUiClientBindings.js";
import { WEB_UI_CLIENT_FOUNDATION_SCRIPT } from "./WebUiClientFoundation.js";
import { WEB_UI_CLIENT_MESSAGES_SCRIPT } from "./WebUiClientMessages.js";
import { WEB_UI_CLIENT_SESSION_SCRIPT } from "./WebUiClientSession.js";

describe("WEB_UI_CLIENT_SCRIPT", () => {
  it("assembles every responsibility fragment in dependency order", () => {
    const fragments = [
      WEB_UI_CLIENT_FOUNDATION_SCRIPT,
      WEB_UI_CLIENT_MESSAGES_SCRIPT,
      WEB_UI_CLIENT_SESSION_SCRIPT,
      WEB_UI_CLIENT_BINDINGS_SCRIPT,
    ];

    let previousIndex = -1;
    for (const fragment of fragments) {
      const fragmentIndex = WEB_UI_CLIENT_SCRIPT.indexOf(fragment);
      expect(fragmentIndex).toBeGreaterThan(previousIndex);
      previousIndex = fragmentIndex;
    }
  });

  it("produces one executable browser controller with its existing endpoints", () => {
    expect(() => new Function(WEB_UI_CLIENT_SCRIPT)).not.toThrow();
    expect(WEB_UI_CLIENT_SCRIPT).toContain("fetch('/api/bootstrap'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/messages')");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/chat'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("new EventSource('/api/events'");
    expect(WEB_UI_CLIENT_SCRIPT).toMatch(/initialize\(\);\s*\}\)\(\);\s*$/);
  });
});
