import type { OrbitConfig } from "@orbit-build/config";

/** Read-only AgentLoop surface exposed to the local Web UI. */
export interface WebUiLoopSnapshot {
  getSessionId?: () => string;
  getGoal?: () => string | undefined;
  getProjectMemory?: () => {
    enabled: boolean;
    entries: Array<{ id: string; text: string }>;
  };
  getTaskPlan?: () =>
    | {
        items: Array<{
          id: string;
          text: string;
          status: "pending" | "in_progress" | "completed";
        }>;
      }
    | undefined;
  getSessionMetrics?: () =>
    | {
        eventCount: number;
        toolRuns: number;
        toolFailures: number;
        deniedTools: number;
        filesChanged: number;
        modelSwitches: number;
        routingDecisions: number;
        fastRoutes: number;
        qualityRoutes: number;
        compactions: number;
        resumedCount: number;
      }
    | undefined;
  getSessions?: () => unknown[];
  getRelevantFiles?: () => Array<{
    path: string;
    reason?: string;
    readOnly?: boolean;
  }>;
  getHistory?: () => unknown[];
  getSessionCost?: () => number;
  getTotalInputTokens?: () => number;
  getTotalCacheReadTokens?: () => number;
  getTotalOutputTokens?: () => number;
  getModelOverride?: () => string | undefined;
  clearModelOverride?: () => void;
  getContextWindowStatus?: () => {
    model: string;
    maxContextTokens: number;
    compactAtTokens: number;
    estimatedHistoryTokens: number;
    utilization: number;
  };
}

/** Settings that may be changed from the local Web UI. */
export interface WebUiSettingsPatch {
  provider?: string;
  model?: string;
  permissionMode?: "strict" | "normal" | "auto" | "plan";
  webSearchEnabled?: boolean;
  webSearchProvider?: "auto" | "searxng" | "tavily" | "bing" | "duckduckgo";
  webSearchMaxResults?: number;
}

/** A session navigation request made by the local Web UI. */
export type WebUiSessionAction =
  | { action: "new" }
  | {
      action: "resume" | "archive" | "restore" | "delete";
      sessionId: string;
    };

/** Open/create a project, or remove its registry entry without deleting files. */
export type WebUiProjectAction =
  | { action: "pick" }
  | { action: "open" | "create"; path: string }
  | { action: "remove"; projectId: string };

/** Result of a project action, including a path selected by the OS picker. */
export interface WebUiProjectActionResult {
  ok: boolean;
  message?: string;
  path?: string;
  cancelled?: boolean;
}

/** A bounded approval request that may be rendered by the local Web UI. */
export interface WebUiApprovalSnapshot {
  id: string;
  kind: "tool" | "change" | "action";
  title: string;
  reason: string;
  preview?: string;
  toolCallId?: string;
  requestedAt: string;
}

/** A browser decision for one currently pending approval request. */
export interface WebUiApprovalDecision {
  id: string;
  approved: boolean;
}

/** Dependencies and callbacks needed to host the local Web UI. */
export interface WebUiOptions {
  cwd: string;
  config: OrbitConfig;
  loop?: WebUiLoopSnapshot;
  port?: number;
  open?: boolean;
  getProjects?: () => Array<{
    id: string;
    path: string;
    name: string;
    lastOpenedAt: string;
    available: boolean;
  }>;
  submitPrompt?: (prompt: string) => Promise<{ ok: boolean; message?: string }>;
  cancelPrompt?: () =>
    | { ok: boolean; message?: string }
    | Promise<{ ok: boolean; message?: string }>;
  updateSettings?: (
    patch: WebUiSettingsPatch,
  ) => Promise<{ ok: boolean; message?: string }>;
  updateSession?: (
    action: WebUiSessionAction,
  ) => Promise<{ ok: boolean; message?: string }>;
  openProject?: (
    action: WebUiProjectAction,
  ) => Promise<WebUiProjectActionResult>;
  getPendingApproval?: () => WebUiApprovalSnapshot | undefined;
  respondToApproval?: (
    decision: WebUiApprovalDecision,
  ) =>
    | { ok: boolean; message?: string }
    | Promise<{ ok: boolean; message?: string }>;
}

/** Handle returned for a running Web UI server. */
export interface WebUiHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** A prompt currently executing through the Web UI bridge. */
export interface ActiveWebTurn {
  id: string;
  sessionId: string;
  startedAt: string;
  cancelRequested: boolean;
}
