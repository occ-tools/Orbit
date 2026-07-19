import { spawn, type ChildProcess } from "child_process";
import {
  readRuntimePackageVersion,
  redactSecrets,
  type ToolRisk,
} from "@orbit-build/shared";
import {
  type OrbitTool,
  type ToolContext,
  type ToolResult,
} from "@orbit-build/tools";
import { z } from "zod";

const MCP_REQUEST_TIMEOUT_MS = 30_000;
const MCP_STDIO_LINE_LIMIT_BYTES = 8 * 1024 * 1024;
const MCP_STDERR_LIMIT_CHARS = 4_000;

const MCPToolDefinitionSchema = z.object({
  name: z.string().min(1).max(512),
  description: z.string().max(10_000).default(""),
  inputSchema: z.record(z.unknown()).default({}),
});
const MCPToolsListSchema = z.object({
  tools: z.array(MCPToolDefinitionSchema).max(10_000).default([]),
});
const MCPToolCallResultSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            type: z.string().max(100),
            text: z.string().max(MCP_STDIO_LINE_LIMIT_BYTES).optional(),
          })
          .passthrough(),
      )
      .max(10_000)
      .default([]),
    isError: z.boolean().default(false),
  })
  .passthrough();
const MCPResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.number().int().positive(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string().max(10_000),
      })
      .passthrough()
      .optional(),
  })
  .refine((message) => message.result !== undefined || message.error, {
    message: "MCP response requires a result or error.",
  });

export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>;
export type MCPToolCallResult = z.infer<typeof MCPToolCallResultSchema>;

export interface MCPToolClient {
  callTool(
    originalToolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolCallResult>;
}

const REQUIRED_RUNTIME_ENV = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
] as const;

export function buildMcpEnvironment(
  configured: Record<string, string>,
  inheritNames: string[],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of new Set([...REQUIRED_RUNTIME_ENV, ...inheritNames])) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  return { ...result, ...configured };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/** A bounded, validated JSON-RPC client for one stdio MCP server. */
export class MCPClient {
  private child: ChildProcess | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private isConnected = false;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrTail = "";

  public constructor(
    public readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {},
    private readonly inheritEnv: string[] = [],
    private readonly clientVersion?: string,
  ) {}

  /** Start the server, complete the MCP handshake, and return validated tools. */
  public async start(): Promise<MCPToolDefinition[]> {
    if (this.child || this.isConnected) {
      throw new Error(`MCP client "${this.serverName}" has already started.`);
    }
    const child = spawn(this.command, this.args, {
      env: buildMcpEnvironment(this.env, this.inheritEnv),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrTail = "";

    child.on("error", (error) => {
      this.cleanup(
        new Error(
          `MCP server "${this.serverName}" failed to start: ${safeMessage(error)}`,
        ),
      );
    });
    child.on("exit", (code, signal) => {
      const detail = this.stderrTail ? `: ${this.stderrTail}` : "";
      this.cleanup(
        new Error(
          `MCP server "${this.serverName}" exited with code ${code} and signal ${signal}${detail}`,
        ),
      );
    });
    child.stdout?.on("data", (data: Buffer | string) => {
      this.handleStdoutChunk(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    child.stderr?.on("data", (data: Buffer | string) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : data;
      this.stderrTail = redactSecrets(`${this.stderrTail}${text}`)
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(-MCP_STDERR_LIMIT_CHARS);
    });

    if (!child.stdin || !child.stdout) {
      await this.stop();
      throw new Error(`MCP server "${this.serverName}" has no stdio channel.`);
    }
    this.isConnected = true;
    try {
      await this.initializeHandshake();
      return await this.listTools();
    } catch (error: unknown) {
      await this.stop();
      throw error;
    }
  }

  /** Call one validated MCP tool with JSON-object arguments. */
  public async callTool(
    originalToolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolCallResult> {
    if (!this.isConnected) {
      throw new Error(`MCP client "${this.serverName}" is not connected.`);
    }
    const result = await this.sendRequest("tools/call", {
      name: originalToolName,
      arguments: args,
    });
    return MCPToolCallResultSchema.parse(result);
  }

  /** Stop the child and reject outstanding requests. */
  public async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.isConnected = false;
    if (child) {
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      child.kill();
    }
    this.cleanup(new Error(`MCP client "${this.serverName}" stopped.`));
  }

  private async initializeHandshake(): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "orbit-client",
        version:
          this.clientVersion ?? readRuntimePackageVersion(import.meta.url),
      },
    });
    this.sendNotification("notifications/initialized");
  }

  private async listTools(): Promise<MCPToolDefinition[]> {
    const result = MCPToolsListSchema.parse(
      await this.sendRequest("tools/list", {}),
    );
    return result.tools;
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const stdin = this.child?.stdin;
      if (!this.isConnected || !stdin || !stdin.writable) {
        reject(new Error("MCP server process is not running."));
        return;
      }
      const id = this.nextRequestId++;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `MCP request "${method}" (id: ${id}) timed out after ${MCP_REQUEST_TIMEOUT_MS}ms.`,
          ),
        );
      }, MCP_REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, { resolve, reject, timeout });
      stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.pendingRequests.get(id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(id);
          pending.reject(
            new Error(`Unable to write MCP request: ${safeMessage(error)}`),
          );
        },
      );
    });
  }

  private sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    const stdin = this.child?.stdin;
    if (!this.isConnected || !stdin || !stdin.writable) return;
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.length > MCP_STDIO_LINE_LIMIT_BYTES) {
      const error = new Error(
        `MCP server "${this.serverName}" exceeded the 8 MiB response-line limit.`,
      );
      this.child?.kill();
      this.cleanup(error);
      return;
    }
    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = this.stdoutBuffer
        .subarray(0, newline)
        .toString("utf8")
        .trim();
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line) this.handleIncomingMessage(line);
    }
  }

  private handleIncomingMessage(line: string): void {
    let response: z.infer<typeof MCPResponseSchema>;
    try {
      response = MCPResponseSchema.parse(JSON.parse(line) as unknown);
    } catch {
      return;
    }
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(
        new Error(
          `MCP error ${response.error.code}: ${safeMessage(response.error.message)}`,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private cleanup(error: Error): void {
    this.isConnected = false;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}

/** Adapt one remote MCP tool to Orbit's validated local tool contract. */
export class DynamicMCPTool implements OrbitTool<
  Record<string, unknown>,
  string
> {
  public readonly name: string;
  public readonly description: string;
  public readonly inputSchema = z.record(z.unknown());
  public readonly risk: ToolRisk;
  private readonly originalToolName: string;

  public constructor(
    serverName: string,
    toolDefinition: MCPToolDefinition,
    risk: ToolRisk,
    private readonly client: MCPToolClient,
  ) {
    this.name = `mcp__${serverName}__${toolDefinition.name}`;
    this.description = `[MCP Tool: ${serverName}] ${toolDefinition.description}`;
    this.risk = risk;
    this.originalToolName = toolDefinition.name;
  }

  public async execute(
    input: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult<string>> {
    try {
      const response = await this.client.callTool(this.originalToolName, input);
      const text = response.content
        .map((content) => content.text || "")
        .filter(Boolean)
        .join("\n");
      if (response.isError) {
        return {
          ok: false,
          error: text || "Unknown MCP tool execution error.",
        };
      }
      return { ok: true, data: text, display: text };
    } catch (error: unknown) {
      return {
        ok: false,
        error: `MCP tool execution failed: ${safeMessage(error)}`,
      };
    }
  }
}
