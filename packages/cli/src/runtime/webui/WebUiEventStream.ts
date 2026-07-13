import type { IncomingMessage, ServerResponse } from "http";
import { eventBus, type OrbitEvent } from "@orbit-build/core";
import type { ActiveWebTurn } from "./WebUiContracts.js";
import { sendJson } from "./WebUiHttp.js";
import { sanitizeWebEventPayload } from "./WebUiSecurity.js";

const WEB_UI_SSE_HEARTBEAT_MS = 15_000;
const WEB_UI_MAX_SSE_CLIENTS = 8;

type WebUiTurnContext = Pick<ActiveWebTurn, "id" | "sessionId">;

/**
 * Owns the SSE clients and Orbit event-bus bridge for one Web UI runtime.
 * A stopped stream cannot be started again, so work left behind by an old
 * runtime can never publish into a replacement runtime.
 */
export class WebUiEventStream {
  private readonly clients = new Map<
    ServerResponse,
    ReturnType<typeof setInterval>
  >();
  private readonly getActiveTurn: () => WebUiTurnContext | undefined;
  private sequence = 0;
  private state: "idle" | "started" | "stopped" = "idle";
  private readonly eventBridge = (event: OrbitEvent): void => {
    const payload = sanitizeWebEventPayload(event.type, event.payload);
    if (payload === undefined) return;
    const turn = this.getActiveTurn();
    this.broadcast({
      kind: "orbit_event",
      id: ++this.sequence,
      timestamp: new Date().toISOString(),
      turnId: turn?.id,
      sessionId: turn?.sessionId,
      type: event.type,
      payload,
    });
  };

  public constructor(getActiveTurn: () => WebUiTurnContext | undefined) {
    this.getActiveTurn = getActiveTurn;
  }

  /** Attach this runtime's event-bus bridge. */
  public start(): void {
    if (this.state === "started") return;
    if (this.state === "stopped") {
      throw new Error("A stopped Web UI event stream cannot be restarted.");
    }
    this.state = "started";
    eventBus.on("*", this.eventBridge);
  }

  /**
   * Detach the event bridge and close every SSE response owned by this
   * runtime. Calls after the first stop are safe no-ops.
   */
  public stop(): void {
    if (this.state === "stopped") return;
    if (this.state === "started") {
      eventBus.off("*", this.eventBridge);
    }
    this.state = "stopped";
    for (const client of [...this.clients.keys()]) {
      this.removeClient(client, false);
      try {
        client.end();
      } catch {
        client.destroy();
      }
    }
  }

  /** Register one authenticated SSE connection with this runtime. */
  public attach(req: IncomingMessage, res: ServerResponse): void {
    if (this.state !== "started") {
      sendJson(res, 503, { error: "Orbit Web UI is stopping." });
      return;
    }
    if (this.clients.size >= WEB_UI_MAX_SSE_CLIENTS) {
      sendJson(res, 429, { error: "Too many Web UI event connections." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    res.write(
      `data: ${JSON.stringify({ kind: "system", message: "connected" })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      if (res.destroyed) {
        this.removeClient(res, false);
        return;
      }
      try {
        const writable = res.write(
          `data: ${JSON.stringify({ kind: "heartbeat", timestamp: new Date().toISOString() })}\n\n`,
        );
        if (!writable) this.removeClient(res, true);
      } catch {
        this.removeClient(res, true);
      }
    }, WEB_UI_SSE_HEARTBEAT_MS);
    heartbeat.unref();
    this.clients.set(res, heartbeat);

    req.once("close", () => this.removeClient(res, false));
    res.once("close", () => this.removeClient(res, false));
  }

  /** Publish an event only to clients owned by this running stream. */
  public broadcast(event: unknown): void {
    if (this.state !== "started") return;
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of [...this.clients.keys()]) {
      if (client.destroyed) {
        this.removeClient(client, false);
        continue;
      }
      try {
        if (!client.write(line)) this.removeClient(client, true);
      } catch {
        this.removeClient(client, true);
      }
    }
  }

  private removeClient(client: ServerResponse, destroy: boolean): void {
    const heartbeat = this.clients.get(client);
    if (heartbeat) clearInterval(heartbeat);
    this.clients.delete(client);
    if (destroy && !client.destroyed) client.destroy();
  }
}
