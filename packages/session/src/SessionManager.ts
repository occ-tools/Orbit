import { SessionStore } from "./SessionStore.js";
import { serializeAuditValue } from "./auditSerialization.js";
import { TaskPlanSchema } from "./types.js";
import type {
  RunJournal,
  Session,
  SessionMetrics,
  StoredHistoryMessage,
  TaskPlan,
  TaskPlanItem,
} from "./types.js";

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
      const previousRun = this.store.getRunJournal(id);
      const recoverable =
        previousRun?.state === "running" ||
        previousRun?.state === "awaiting_approval" ||
        previousRun?.state === "verifying";
      if (recoverable && previousRun) {
        this.store.saveRunJournal(id, {
          ...previousRun,
          state: "interrupted",
          phase: `Recovered after interruption during ${previousRun.phase}`,
          updatedAt: new Date().toISOString(),
          recoveryCount: previousRun.recoveryCount + 1,
        });
      }
      this.logEvent("session_resume", { id, recoverable });
    }
    return this.currentSession;
  }

  public getActiveSession(): Session | undefined {
    return this.currentSession;
  }

  /** Persist or clear the active session's durable objective. */
  public setGoal(goal?: string): void {
    if (!this.currentSession) return;
    const normalized = goal?.trim() || undefined;
    this.currentSession = { ...this.currentSession, goal: normalized };
    this.store.updateSession(this.currentSession);
    this.logEvent("session_goal", { goal: normalized || null });
  }

  /** Rename the active session without changing its history. */
  public setTitle(title: string): void {
    if (!this.currentSession) return;
    this.currentSession = { ...this.currentSession, title: title.trim() };
    this.store.updateSession(this.currentSession);
    this.logEvent("session_title", { title: this.currentSession.title });
  }

  /** Persists the lifecycle status for the current session. */
  public setStatus(status: SessionStatus): void {
    if (!this.currentSession || this.currentSession.status === status) return;
    this.currentSession = { ...this.currentSession, status };
    this.store.updateSession(this.currentSession);
    this.logEvent("session_status", { status });
  }

  /** Update the active runtime without replacing this session or its history. */
  public setRuntime(provider: string, model: string): void {
    if (!this.currentSession) return;
    if (
      this.currentSession.provider === provider &&
      this.currentSession.model === model
    ) {
      return;
    }
    this.currentSession = {
      ...this.currentSession,
      provider,
      model,
      updatedAt: new Date().toISOString(),
    };
    this.store.updateSession(this.currentSession);
    this.logEvent("session_runtime", { provider, model });
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

  public getTaskPlan(): TaskPlan | undefined {
    if (!this.currentSession) return undefined;
    return this.store.getTaskPlan(this.currentSession.id);
  }

  public saveTaskPlan(
    items: TaskPlanItem[],
    goal?: string,
  ): TaskPlan | undefined {
    if (!this.currentSession) return undefined;
    const plan = TaskPlanSchema.parse({
      sessionId: this.currentSession.id,
      goal: goal?.trim() || this.currentSession.goal,
      items,
      updatedAt: new Date().toISOString(),
    });
    const saved = this.store.saveTaskPlan(this.currentSession.id, plan);
    this.logEvent("task_plan_updated", {
      itemCount: saved.items.length,
      completedCount: saved.items.filter((item) => item.status === "completed")
        .length,
    });
    return saved;
  }

  public getMetrics(): SessionMetrics | undefined {
    if (!this.currentSession) return undefined;
    return this.store.getMetrics(this.currentSession.id);
  }

  /** Update the durable execution journal used for crash recovery and trace export. */
  public setRunState(
    state: RunJournal["state"],
    phase: string,
    options: { attempt?: number; activeToolCallId?: string } = {},
  ): RunJournal | undefined {
    if (!this.currentSession) return undefined;
    const previous = this.store.getRunJournal(this.currentSession.id);
    const now = new Date().toISOString();
    return this.store.saveRunJournal(this.currentSession.id, {
      schemaVersion: 1,
      sessionId: this.currentSession.id,
      state,
      phase,
      attempt: options.attempt ?? previous?.attempt ?? 0,
      activeToolCallId: options.activeToolCallId,
      startedAt: previous?.startedAt || now,
      updatedAt: now,
      recoveryCount: previous?.recoveryCount || 0,
    });
  }

  public getRunJournal(): RunJournal | undefined {
    if (!this.currentSession) return undefined;
    return this.store.getRunJournal(this.currentSession.id);
  }
}
