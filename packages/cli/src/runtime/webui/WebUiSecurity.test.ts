import type { IncomingMessage } from "http";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isAuthorizedWebRequest,
  safeWebMessage,
  sanitizeBaseUrl,
  sanitizeWebEventPayload,
  webRequestErrorStatus,
} from "./WebUiSecurity.js";

function requestWithHeaders(
  headers: IncomingMessage["headers"],
): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("WebUiSecurity", () => {
  it("allowlists event fields and redacts browser-facing text", () => {
    expect(
      sanitizeWebEventPayload("tool_proposal", {
        toolCallId: "tool-1",
        toolName: "bash",
        explanation: "Bearer private-token",
        arguments: { apiKey: "must-not-leak" },
      }),
    ).toEqual({
      toolCallId: "tool-1",
      toolName: "bash",
      explanation: "Bearer ***REDACTED***",
    });
    expect(
      sanitizeWebEventPayload("untrusted_event", { private: true }),
    ).toBeUndefined();
  });

  it("removes URL credentials, queries, and fragments", () => {
    expect(
      sanitizeBaseUrl(
        "https://user:password@example.com/v1?api_key=private#secret",
      ),
    ).toBe("https://example.com/v1");
  });

  it("requires a matching token and same-origin request", () => {
    expect(
      isAuthorizedWebRequest(
        requestWithHeaders({
          host: "127.0.0.1:6047",
          origin: "http://127.0.0.1:6047",
          authorization: "Bearer expected-token",
        }),
        "expected-token",
      ),
    ).toBe(true);
    expect(
      isAuthorizedWebRequest(
        requestWithHeaders({
          host: "127.0.0.1:6047",
          origin: "https://attacker.invalid",
          authorization: "Bearer expected-token",
        }),
        "expected-token",
      ),
    ).toBe(false);
  });

  it("maps validation and size failures without leaking raw errors", () => {
    const validationError = z.string().safeParse(42).error;
    expect(webRequestErrorStatus(validationError)).toBe(400);
    expect(webRequestErrorStatus(new Error("Request body too large."))).toBe(
      413,
    );
    expect(safeWebMessage(new Error("Bearer private-token"))).toBe(
      "Bearer ***REDACTED***",
    );
  });
});
