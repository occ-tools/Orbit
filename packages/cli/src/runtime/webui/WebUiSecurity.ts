import type { IncomingMessage } from "http";
import { timingSafeEqual } from "crypto";
import { redactSecrets } from "@orbit-build/shared";
import { z } from "zod";

/** Allowlist and redact an internal event before exposing it to a browser. */
export function sanitizeWebEventPayload(
  type: string,
  payload: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  switch (type) {
    case "model_request":
      return { model: safeWebText(payload.model, 200) };
    case "model_response":
      return {
        model: safeWebText(payload.model, 200),
        usage: sanitizeTokenUsage(payload.usage),
      };
    case "model_delta":
    case "thinking_delta":
      return { text: safeWebText(payload.text, 65_536) };
    case "tool_proposal":
      return {
        toolCallId: safeWebText(payload.toolCallId, 200),
        toolName: safeWebText(payload.toolName, 200),
        explanation: safeWebText(payload.explanation, 500),
      };
    case "tool_result":
      return {
        toolCallId: safeWebText(payload.toolCallId, 200),
        toolName: safeWebText(payload.toolName, 200),
        error: safeWebText(payload.error, 1_000),
      };
    case "tool_approval":
      return {
        toolCallId: safeWebText(payload.toolCallId, 200),
        approved: payload.approved === true,
        reason: safeWebText(payload.reason, 500),
      };
    case "cost_update":
      return {
        turnCost: safeNumber(payload.turnCost),
        sessionCost: safeNumber(payload.sessionCost),
        totalInputTokens: safeNumber(payload.totalInputTokens),
        totalCacheReadTokens: safeNumber(payload.totalCacheReadTokens),
        totalOutputTokens: safeNumber(payload.totalOutputTokens),
      };
    case "cache_update":
      return {
        hitTokens: safeNumber(payload.hitTokens),
        missTokens: safeNumber(payload.missTokens),
        inputTokens: safeNumber(payload.inputTokens),
        hitRate: safeNumber(payload.hitRate),
        degraded: payload.degraded === true,
      };
    case "loop_start":
      return { attempt: safeNumber(payload.attempt) };
    case "verification_started":
      return { type: safeWebText(payload.type, 100) };
    case "verification_ended":
      return { success: payload.success === true };
    case "checkpoint_created":
      return {
        timestamp: safeWebText(payload.timestamp, 100),
        message: safeWebText(payload.message, 500),
      };
    case "file_change":
      return {
        filePath: safeWebText(payload.filePath, 500),
        type: safeWebText(payload.type, 20),
        explanation: safeWebText(payload.explanation, 500),
      };
    case "info":
    case "warning":
    case "error":
      return { message: safeWebText(payload.message, 2_000) };
    default:
      return undefined;
  }
}

/** Validate either a bearer token or the protected local session cookie. */
export function isAuthorizedWebRequest(
  req: IncomingMessage,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || !isRequestOriginAllowed(req)) return false;
  const authorization = req.headers.authorization;
  const cookieToken = readCookie(req, "orbit_web_token");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : cookieToken;
  return safeTokenMatch(supplied, expectedToken);
}

/** Validate the one-time bearer token used to establish the browser cookie. */
export function isBearerAuthorizedWebRequest(
  req: IncomingMessage,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || !isRequestOriginAllowed(req)) return false;
  const authorization = req.headers.authorization;
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  return safeTokenMatch(supplied, expectedToken);
}

/** Convert an unknown failure into a bounded, credential-safe browser message. */
export function safeWebMessage(error: unknown): string {
  return safeWebText(
    error instanceof Error ? error.message : String(error),
    2_000,
  );
}

/** Sanitize an action result crossing the Web UI boundary. */
export function sanitizeActionResult(result: {
  ok: boolean;
  message?: string;
}): { ok: boolean; message?: string } {
  return result.message
    ? { ok: result.ok, message: safeWebMessage(result.message) }
    : { ok: result.ok };
}

/** Remove credentials and query data from a provider base URL. */
export function sanitizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return safeWebText(value, 500);
  }
}

/** Map request-boundary failures to an HTTP status without leaking details. */
export function webRequestErrorStatus(error: unknown): number {
  if (error instanceof z.ZodError) return 400;
  if (error instanceof Error && error.message === "Request body too large.") {
    return 413;
  }
  return 500;
}

/** Narrow an unknown failure to a Node error with an optional error code. */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function isRequestOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

function safeTokenMatch(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function readCookie(req: IncomingMessage, name: string): string {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return "";
  for (const item of rawCookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function sanitizeTokenUsage(
  value: unknown,
): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: safeNumber(value.inputTokens),
    outputTokens: safeNumber(value.outputTokens),
    cacheReadTokens: safeNumber(value.cacheReadTokens),
    cacheWriteTokens: safeNumber(value.cacheWriteTokens),
  };
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeWebText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return redactSecrets(stripAnsi(value)).slice(0, maxLength);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
