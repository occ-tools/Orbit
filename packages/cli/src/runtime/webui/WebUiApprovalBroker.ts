import { randomUUID } from "crypto";
import { eventBus } from "@orbit-build/core";
import { redactSecrets } from "@orbit-build/shared";
import type {
  WebUiApprovalDecision,
  WebUiApprovalSnapshot,
} from "./WebUiContracts.js";

const WEB_APPROVAL_TIMEOUT_MS = 10 * 60 * 1_000;

interface PendingApproval {
  snapshot: WebUiApprovalSnapshot;
  resolve(approved: boolean): void;
  timeout: ReturnType<typeof setTimeout>;
}

export type WebUiApprovalRequest = Omit<
  WebUiApprovalSnapshot,
  "id" | "requestedAt"
>;

/** Bridges one blocking agent confirmation to an authenticated Web UI. */
export class WebUiApprovalBroker {
  private pending: PendingApproval | undefined;

  public getPending(): WebUiApprovalSnapshot | undefined {
    return this.pending ? { ...this.pending.snapshot } : undefined;
  }

  public request(request: WebUiApprovalRequest): Promise<boolean> {
    if (this.pending) {
      throw new Error("Another Web UI approval is already pending.");
    }
    const snapshot = sanitizeApprovalRequest(request);
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(
        () => this.settle(false),
        WEB_APPROVAL_TIMEOUT_MS,
      );
      timeout.unref();
      this.pending = { snapshot, resolve, timeout };
      eventBus.emitEvent("web_approval_requested", {
        approvalId: snapshot.id,
        kind: snapshot.kind,
        title: snapshot.title,
        toolCallId: snapshot.toolCallId,
      });
    });
  }

  public respond(decision: WebUiApprovalDecision): {
    ok: boolean;
    message?: string;
  } {
    if (!this.pending || this.pending.snapshot.id !== decision.id) {
      return { ok: false, message: "Approval request is no longer active." };
    }
    this.settle(decision.approved);
    return { ok: true };
  }

  public cancel(): void {
    this.settle(false);
  }

  private settle(approved: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timeout);
    eventBus.emitEvent("web_approval_resolved", {
      approvalId: pending.snapshot.id,
      approved,
    });
    pending.resolve(approved);
  }
}

function sanitizeApprovalRequest(
  request: WebUiApprovalRequest,
): WebUiApprovalSnapshot {
  return {
    id: randomUUID(),
    kind: request.kind,
    title: safeApprovalText(request.title, 200, false),
    reason: safeApprovalText(request.reason, 1_500, false),
    preview: request.preview
      ? safeApprovalText(request.preview, 24_000, true)
      : undefined,
    toolCallId: request.toolCallId
      ? safeApprovalText(request.toolCallId, 200, false)
      : undefined,
    requestedAt: new Date().toISOString(),
  };
}

function safeApprovalText(
  value: string,
  maxLength: number,
  preserveLines: boolean,
): string {
  const redacted = redactSecrets(value)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(
      preserveLines
        ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
        : /[\u0000-\u001f\u007f]/g,
      " ",
    );
  return (preserveLines ? redacted : redacted.replace(/\s+/g, " "))
    .trim()
    .slice(0, maxLength);
}
