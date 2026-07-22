import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "http";
import { StreamableHttpMCPClient } from "./StreamableHttpMCPClient.js";

describe("StreamableHttpMCPClient", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>(
      (resolve) => server?.close(() => resolve()) ?? resolve(),
    );
  });

  it("handshakes, retains the session ID, lists tools, and calls tools", async () => {
    const methods: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += String(chunk)));
      request.on("end", () => {
        const message = JSON.parse(body) as {
          id?: number;
          method: string;
        };
        methods.push(message.method);
        if (message.method === "notifications/initialized") {
          expect(request.headers["mcp-session-id"]).toBe("session-123");
          response.writeHead(202).end();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Mcp-Session-Id", "session-123");
        const result =
          message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "read_status",
                    description: "Read status",
                    inputSchema: { type: "object" },
                  },
                ],
              }
            : message.method === "tools/call"
              ? { content: [{ type: "text", text: "ok" }], isError: false }
              : { protocolVersion: "2024-11-05", capabilities: {} };
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const client = new StreamableHttpMCPClient(
      "test",
      `http://127.0.0.1:${address.port}`,
    );

    await expect(client.start()).resolves.toEqual([
      expect.objectContaining({ name: "read_status" }),
    ]);
    await expect(client.callTool("read_status", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    await client.stop();
  });

  it("rejects plaintext non-loopback endpoints before sending credentials", async () => {
    const client = new StreamableHttpMCPClient(
      "unsafe",
      "http://example.com/mcp",
      { bearerTokenEnv: "MCP_TOKEN" },
    );

    await expect(client.start()).rejects.toThrow("must use HTTPS");
  });
});
