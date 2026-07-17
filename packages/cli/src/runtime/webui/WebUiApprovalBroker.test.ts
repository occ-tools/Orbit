import { describe, expect, it } from "vitest";
import { WebUiApprovalBroker } from "./WebUiApprovalBroker.js";

describe("WebUiApprovalBroker", () => {
  it("holds one sanitized approval and resolves the matching decision", async () => {
    const broker = new WebUiApprovalBroker();
    const result = broker.request({
      kind: "tool",
      title: "Run bash",
      reason: "Bearer private-token-value",
      preview: "+ safe\n- secret=private-value",
      toolCallId: "tool-1",
    });
    const pending = broker.getPending();

    expect(pending).toMatchObject({
      kind: "tool",
      title: "Run bash",
      reason: "Bearer ***REDACTED***",
      toolCallId: "tool-1",
    });
    expect(broker.respond({ id: "stale-id", approved: true }).ok).toBe(false);
    expect(broker.respond({ id: pending!.id, approved: true }).ok).toBe(true);
    await expect(result).resolves.toBe(true);
    expect(broker.getPending()).toBeUndefined();
  });

  it("denies a pending request when the Web turn is cancelled", async () => {
    const broker = new WebUiApprovalBroker();
    const result = broker.request({
      kind: "change",
      title: "Review change",
      reason: "Review the diff",
    });
    broker.cancel();
    await expect(result).resolves.toBe(false);
  });
});
