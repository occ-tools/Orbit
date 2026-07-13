import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./EventBus.js";

describe("EventBus", () => {
  it("does not publish payloads that fail runtime validation", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    const emitted = bus.emitEvent("info", { message: 42 } as never);

    expect(emitted).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes the validated event envelope", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    expect(bus.emitEvent("info", { message: "ready" })).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      type: "info",
      payload: { message: "ready" },
    });
  });

  it("publishes error envelopes without triggering EventEmitter's unhandled error", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("*", listener);

    expect(bus.emitEvent("error", { message: "failed" })).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      type: "error",
      payload: { message: "failed" },
    });
  });
});
