import type { OrbitConfig } from "@orbit-build/config";

/** Read-only AgentLoop surface exposed to the local Web UI. */
export interface WebUiLoopSnapshot {
  getSessionId?: () => string;
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
  model?: string;
  permissionMode?: "strict" | "normal" | "auto" | "plan";
  webSearchEnabled?: boolean;
  webSearchProvider?: "auto" | "searxng" | "tavily" | "bing" | "duckduckgo";
  webSearchMaxResults?: number;
}

/** A session navigation request made by the local Web UI. */
export type WebUiSessionAction =
  | { action: "new" }
  | { action: "resume"; sessionId: string };

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
