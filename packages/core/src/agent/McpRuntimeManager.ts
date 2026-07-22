import type { OrbitConfig } from "@orbit-build/config";
import {
  DynamicMCPTool,
  MCPClient,
  StreamableHttpMCPClient,
  type MCPToolClient,
  type MCPToolDefinition,
} from "@orbit-build/mcp";
import type { ToolRegistry } from "@orbit-build/tools";
import { redactSecrets } from "@orbit-build/shared";

type McpServers = OrbitConfig["mcpServers"];

export interface McpRuntimeClient extends MCPToolClient {
  start(): Promise<MCPToolDefinition[]>;
  stop(): ReturnType<MCPClient["stop"]>;
}

export type McpRuntimeClientFactory = (
  serverName: string,
  serverConfig: McpServers[string],
) => McpRuntimeClient;

export interface McpRuntimeStartResult {
  startedServers: number;
  registeredTools: number;
  failures: Array<{ serverName: string; message: string }>;
}

/** Owns MCP server processes and their temporary dynamic tool registrations. */
export class McpRuntimeManager {
  private readonly clients: McpRuntimeClient[] = [];
  private readonly registeredToolNames = new Set<string>();

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly createClient: McpRuntimeClientFactory = (
      serverName,
      serverConfig,
    ) => {
      if (serverConfig.transport === "streamable-http") {
        if (!serverConfig.url) {
          throw new Error(
            `MCP server "${serverName}" requires a URL for streamable-http transport.`,
          );
        }
        return new StreamableHttpMCPClient(serverName, serverConfig.url, {
          headers: serverConfig.headers,
          bearerTokenEnv: serverConfig.bearerTokenEnv,
          oauth: serverConfig.oauth,
        });
      }
      if (!serverConfig.command) {
        throw new Error(
          `MCP server "${serverName}" requires a command for stdio transport.`,
        );
      }
      return new MCPClient(
        serverName,
        serverConfig.command,
        serverConfig.args ?? [],
        serverConfig.env ?? {},
        serverConfig.inheritEnv ?? [],
      );
    },
  ) {}

  public async start(
    servers: McpServers,
    report: (message: string) => void,
  ): Promise<McpRuntimeStartResult> {
    await this.stop();
    const result: McpRuntimeStartResult = {
      startedServers: 0,
      registeredTools: 0,
      failures: [],
    };

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      const client = this.createClient(serverName, serverConfig);
      const registeredForClient: string[] = [];
      try {
        const tools = await client.start();

        for (const toolDefinition of tools) {
          const risk =
            serverConfig.tools?.[toolDefinition.name]?.risk ?? "execute";
          const dynamicTool = new DynamicMCPTool(
            serverName,
            toolDefinition,
            risk,
            client,
          );
          if (this.registry.get(dynamicTool.name)) {
            throw new Error(
              `MCP tool name collision after normalization: "${dynamicTool.name}". Rename the server or remote tool.`,
            );
          }
          this.registry.register(dynamicTool);
          this.registeredToolNames.add(dynamicTool.name);
          registeredForClient.push(dynamicTool.name);
          result.registeredTools += 1;
          report(`  ✔ Registered MCP tool: ${dynamicTool.name} (${risk})`);
        }
        this.clients.push(client);
        result.startedServers += 1;
      } catch (error: unknown) {
        for (const toolName of registeredForClient) {
          this.registry.unregister(toolName);
          this.registeredToolNames.delete(toolName);
          result.registeredTools -= 1;
        }
        await client.stop().catch(() => undefined);
        const message = safeMcpRuntimeMessage(error);
        result.failures.push({ serverName, message });
        report(`  ✖ Failed to start MCP server "${serverName}": ${message}`);
      }
    }

    return result;
  }

  public async stop(): Promise<void> {
    for (const toolName of this.registeredToolNames) {
      this.registry.unregister(toolName);
    }
    this.registeredToolNames.clear();

    const clients = this.clients.splice(0);
    await Promise.allSettled(clients.map((client) => client.stop()));
  }
}

function safeMcpRuntimeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    redactSecrets(raw)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000) || "Unknown MCP startup failure."
  );
}
