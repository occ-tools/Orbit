import { randomUUID } from "crypto";
import { readRuntimePackageVersion, redactSecrets } from "@orbit-build/shared";
import {
  MCPToolCallResultSchema,
  MCPToolsListSchema,
  type MCPToolCallResult,
  type MCPToolClient,
  type MCPToolDefinition,
} from "./MCPClient.js";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export interface McpOAuthClientCredentials {
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scope?: string;
  audience?: string;
}

export interface StreamableHttpMCPClientOptions {
  headers?: Record<string, string>;
  bearerTokenEnv?: string;
  oauth?: McpOAuthClientCredentials;
  clientVersion?: string;
}

interface OAuthToken {
  accessToken: string;
  expiresAt: number;
}

/** MCP Streamable HTTP client with bounded responses and OAuth client credentials. */
export class StreamableHttpMCPClient implements MCPToolClient {
  private requestId = 1;
  private sessionId: string | undefined;
  private token: OAuthToken | undefined;
  private started = false;

  public constructor(
    public readonly serverName: string,
    private readonly url: string,
    private readonly options: StreamableHttpMCPClientOptions = {},
  ) {}

  public async start(): Promise<MCPToolDefinition[]> {
    if (this.started) {
      throw new Error(`MCP client "${this.serverName}" has already started.`);
    }
    assertSecureMcpUrl(this.url, "MCP server");
    if (this.options.oauth) {
      assertSecureMcpUrl(
        this.options.oauth.tokenUrl,
        "MCP OAuth token endpoint",
      );
    }
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "orbit-client",
        version:
          this.options.clientVersion ??
          readRuntimePackageVersion(import.meta.url),
      },
    });
    this.started = true;
    await this.notify("notifications/initialized");
    const result = MCPToolsListSchema.parse(
      await this.request("tools/list", {}),
    );
    return result.tools;
  }

  public async callTool(
    originalToolName: string,
    args: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<MCPToolCallResult> {
    if (!this.started) {
      throw new Error(`MCP client "${this.serverName}" is not connected.`);
    }
    return MCPToolCallResultSchema.parse(
      await this.request(
        "tools/call",
        { name: originalToolName, arguments: args },
        abortSignal,
      ),
    );
  }

  public async stop(): Promise<void> {
    if (this.started) {
      await this.notify("notifications/cancelled", {
        requestId: randomUUID(),
        reason: "Orbit MCP runtime stopped",
      }).catch(() => undefined);
    }
    this.started = false;
    this.sessionId = undefined;
    this.token = undefined;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.requestId++;
    const response = await this.post(
      { jsonrpc: "2.0", id, method, params },
      abortSignal,
    );
    if (!response || typeof response !== "object") {
      throw new Error(`MCP server "${this.serverName}" returned no response.`);
    }
    const record = response as Record<string, unknown>;
    if (record.error && typeof record.error === "object") {
      const error = record.error as Record<string, unknown>;
      throw new Error(
        `MCP error ${String(error.code ?? "unknown")}: ${safeMessage(error.message)}`,
      );
    }
    return record.result;
  }

  private async notify(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params });
  }

  private async post(
    payload: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    let refreshed = false;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      externalSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        const authorization = await this.authorizationHeader(refreshed);
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...this.options.headers,
            ...(authorization ? { Authorization: authorization } : {}),
            ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: "error",
        });
        if (response.status === 401 && this.options.oauth && !refreshed) {
          this.token = undefined;
          refreshed = true;
          continue;
        }
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 2_000);
          throw new Error(
            `MCP HTTP ${response.status}: ${safeMessage(detail || response.statusText)}`,
          );
        }
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId.slice(0, 512);
        if (response.status === 202 || response.status === 204)
          return undefined;
        const body = await readBoundedResponse(response);
        const contentType = response.headers.get("content-type") || "";
        return contentType.includes("text/event-stream")
          ? parseSseJson(body)
          : JSON.parse(body);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          const aborted = new Error(
            externalSignal?.aborted
              ? `MCP request to "${this.serverName}" was cancelled.`
              : `MCP request to "${this.serverName}" timed out.`,
          );
          aborted.name = "AbortError";
          throw aborted;
        }
        throw new Error(
          `MCP server "${this.serverName}" request failed: ${safeMessage(error)}`,
        );
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", onAbort);
      }
    }
  }

  private async authorizationHeader(forceRefresh: boolean): Promise<string> {
    if (this.options.oauth) {
      if (
        forceRefresh ||
        !this.token ||
        this.token.expiresAt - Date.now() < 30_000
      ) {
        this.token = await fetchClientCredentialsToken(this.options.oauth);
      }
      return `Bearer ${this.token.accessToken}`;
    }
    const token = this.options.bearerTokenEnv
      ? process.env[this.options.bearerTokenEnv]
      : undefined;
    return token ? `Bearer ${token}` : "";
  }
}

async function fetchClientCredentialsToken(
  oauth: McpOAuthClientCredentials,
): Promise<OAuthToken> {
  const clientId = process.env[oauth.clientIdEnv];
  const clientSecret = process.env[oauth.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `MCP OAuth credentials are missing. Set ${oauth.clientIdEnv} and ${oauth.clientSecretEnv}.`,
    );
  }
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (oauth.scope) body.set("scope", oauth.scope);
  if (oauth.audience) body.set("audience", oauth.audience);
  const response = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(
      `MCP OAuth token request failed with HTTP ${response.status}.`,
    );
  }
  const result = (await response.json()) as Record<string, unknown>;
  if (typeof result.access_token !== "string" || !result.access_token) {
    throw new Error("MCP OAuth response did not include an access token.");
  }
  const expiresIn =
    typeof result.expires_in === "number" && Number.isFinite(result.expires_in)
      ? Math.max(60, result.expires_in)
      : 3600;
  return {
    accessToken: result.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("MCP HTTP response exceeded the 8 MiB limit.");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function parseSseJson(body: string): unknown {
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .pop();
  if (!data) throw new Error("MCP SSE response contained no JSON data.");
  return JSON.parse(data);
}

function safeMessage(value: unknown): string {
  return redactSecrets(value instanceof Error ? value.message : String(value))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}

function assertSecureMcpUrl(value: string, label: string): void {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${label} must use HTTPS unless it is on loopback.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} cannot contain URL credentials.`);
  }
}
