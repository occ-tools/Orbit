import { describe, expect, it } from "vitest";
import { buildTuiConversationViewModel } from "./TuiConversationViewModel.js";

describe("TuiConversationViewModel", () => {
  it("groups user, system and assistant messages into stable turns", () => {
    const user = { role: "user" as const, text: "inspect" };
    const status = { role: "system" as const, text: "running" };
    const assistant = { role: "assistant" as const, text: "done" };
    const nextUser = { role: "user" as const, text: "verify" };

    expect(
      buildTuiConversationViewModel([user, status, assistant, nextUser]),
    ).toEqual({
      turns: [
        { user, system: [status], assistant },
        { user: nextUser, system: [] },
      ],
      lastAssistant: assistant,
    });
  });

  it("keeps leading system and assistant output visible", () => {
    const status = { role: "system" as const, text: "restored" };
    const assistant = { role: "assistant" as const, text: "continued" };

    expect(buildTuiConversationViewModel([status, assistant])).toEqual({
      turns: [{ system: [status], assistant }],
      lastAssistant: assistant,
    });
  });

  it("returns an empty view model for an empty history", () => {
    expect(buildTuiConversationViewModel([])).toEqual({
      turns: [],
      lastAssistant: undefined,
    });
  });
});
