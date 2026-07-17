import { SessionStore } from "./SessionStore.js";
import { serializeAuditValue } from "./auditSerialization.js";
import type { Session, StoredHistoryMessage } from "./types.js";

export type SessionStatus = Session["status"];

function getToolCallId(input: unknown): string {
  try {
    if (
      typeof input === "object" &&
      input !== null &&
      "id" in input &&
      typeof input.id === "string" &&
      input.id.trim().length > 0
    ) {
      return input.id;
    }
  } catch {
    // Hostile proxies and getters must not break session bookkeeping.
  }
  return "tc_unknown";
}

export class SessionManager {
  private store: SessionStore;
  private currentSession?: Session;

  constructor(cwd: string, sessionRootPath = ".orbit/sessions") {
    this.store = new SessionStore(cwd, sessionRootPath);
  }

  public startNewSession(provider: string, model: string): Session {
    this.currentSession = this.store.createSession(provider, model);
    this.logEvent("session_start", { provider, model });
    return this.currentSession;
  }

  public resumeSession(id: string): Session | undefined {
    const session = this.store.getSession(id);
    if (session) {
      this.currentSession = { ...session, status: "active" };
      this.store.updateSession(this.currentSession);
      this.logEvent("session_resume", { id });
    }
    return this.currentSession;
  }

  public getActiveSession(): Session | undefined {
    return this.currentSession;
  }

  /** Persists the lifecycle status for the current session. */
  public setStatus(status: SessionStatus): void {
    if (!this.currentSession || this.currentSession.status === status) return;
    this.currentSession = { ...this.currentSession, status };
    this.store.updateSession(this.currentSession);
    this.logEvent("session_status", { status });
  }

  public logEvent(type: string, payload: unknown): void {
    if (!this.currentSession) return;
    this.store.appendEvent(this.currentSession.id, type, payload);
  }

  public recordToolExecution(
    toolName: string,
    input: unknown,
    output: unknown,
    risk: string,
    decision: string,
    status: "success" | "failed" | "denied",
  ): void {
    if (!this.currentSession) return;

    this.store.recordToolCall({
      sessionId: this.currentSession.id,
      id: getToolCallId(input),
      toolName,
      inputJson: serializeAuditValue(input),
      outputJson: serializeAuditValue(output),
      risk,
      permissionDecision: decision,
      status,
    });

    this.logEvent("tool_execution", { toolName, status });
  }

  public recordFileModification(
    path: string,
    diff: string,
    beforeHash?: string,
    afterHash?: string,
  ): void {
    if (!this.currentSession) return;

    this.store.recordFileChange({
      sessionId: this.currentSession.id,
      path,
      beforeHash,
      afterHash,
      diff,
    });

    this.logEvent("file_modified", { path });
  }

  public getSessionStore(): SessionStore {
    return this.store;
  }

  public saveHistory(history: unknown): void {
    if (!this.currentSession) return;
    this.store.saveHistory(this.currentSession.id, history);
  }

  public getHistory(): StoredHistoryMessage[] {
    if (!this.currentSession) return [];
    return this.store.getHistory(this.currentSession.id);
  }
}
