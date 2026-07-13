import type { OrbitConfig } from "@orbit-build/config";

/** Read-only AgentLoop surface exposed to the local Web UI. */
export interface WebUiLoopSnapshot {
  getSessionId?: () => string;
  getSessions?: () => unknown[];
  getRelevantFiles?: () => Array<{ path: string; reason?: string }>;
  getHistory?: () => unknown[];
  getSessionCost?: () => number;
  getTotalInputTokens?: () => number;
  getTotalCacheReadTokens?: () => number;
  getTotalOutputTokens?: () => number;
  getModelOverride?: () => string | undefined;
}

/** Settings that may be changed from the local Web UI. */
export interface WebUiSettingsPatch {
  model?: string;
  permissionMode?: "strict" | "normal" | "auto" | "plan";
  webSearchEnabled?: boolean;
  webSearchProvider?: "auto" | "searxng" | "tavily" | "bing" | "duckduckgo";
  webSearchMaxResults?: number;
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
