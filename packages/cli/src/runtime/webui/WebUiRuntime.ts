import http, { type IncomingMessage, type ServerResponse } from "http";
import { randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import { getAutocompleteCandidates } from "../AutocompleteCandidates.js";
import {
  type ActiveWebTurn,
  type WebUiHandle,
  type WebUiOptions,
} from "./WebUiContracts.js";
import { WEB_UI_CLIENT_SCRIPT } from "./WebUiClient.js";
import { WEB_UI_FAVICON_SVG } from "./WebUiBrand.js";
import {
  collectWebUiMessages,
  collectWebUiSettings,
  collectWebUiStatus,
  filterWebUiCompletionFiles,
} from "./WebUiData.js";
import { WebUiEventStream } from "./WebUiEventStream.js";
import {
  bootstrapWebSession,
  readJsonBody,
  sendAsset,
  sendHtml,
  sendJson,
} from "./WebUiHttp.js";
import { renderWebUiPage } from "./WebUiPage.js";
import {
  isAuthorizedWebRequest,
  isAuthorizedWebEventRequest,
  isBearerAuthorizedWebRequest,
  isNodeError,
  safeWebMessage,
  sanitizeActionResult,
  sanitizeProjectActionResult,
  webRequestErrorStatus,
} from "./WebUiSecurity.js";
import { WEB_UI_STYLES } from "./WebUiStyles.js";

const WebTurnIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const ChatRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(100_000),
    turnId: WebTurnIdSchema.optional(),
  })
  .strict();
const CancelRequestSchema = z
  .object({ turnId: WebTurnIdSchema.nullish() })
  .strict();
const ApprovalDecisionSchema = z
  .object({
    id: WebTurnIdSchema,
    approved: z.boolean(),
  })
  .strict();
const SettingsPatchSchema = z
  .object({
    provider: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    permissionMode: z.enum(["strict", "normal", "auto", "plan"]).optional(),
    webSearchEnabled: z.boolean().optional(),
    webSearchProvider: z
      .enum(["auto", "searxng", "tavily", "bing", "duckduckgo"])
      .optional(),
    webSearchMaxResults: z.number().int().min(1).max(20).optional(),
  })
  .strict();
const SessionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("new") }).strict(),
  ...(["resume", "archive", "restore", "delete"] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        sessionId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[a-zA-Z0-9_-]+$/),
      })
      .strict(),
  ),
]);
const ProjectActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pick") }).strict(),
  z
    .object({
      action: z.enum(["open", "create"]),
      path: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      projectId: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict(),
]);
const CompletionQuerySchema = z.string().trim().max(200);

type RuntimeState = "idle" | "starting" | "running" | "stopping" | "stopped";

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolveListen(
        typeof address === "object" && address ? address.port : port,
      );
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * A single-use Orbit Web UI server instance. All mutable request, turn,
 * authentication, and event-stream state belongs to this instance.
 */
export class OrbitWebUiRuntime {
  private options: WebUiOptions;
  private readonly events: WebUiEventStream;
  private state: RuntimeState = "idle";
  private token: string | undefined;
  private activeTurn: ActiveWebTurn | undefined;
  private server: http.Server | undefined;
  private handle: WebUiHandle | undefined;
  private stopPromise: Promise<void> | undefined;
  private completionFilesPromise: Promise<string[]> | undefined;

  public constructor(options: WebUiOptions) {
    this.options = options;
    this.events = new WebUiEventStream(() => this.activeTurn);
  }

  /** Whether this instance currently accepts Web UI requests. */
  public get isRunning(): boolean {
    return this.state === "running";
  }

  /** Whether a prompt owned by this instance has not completed yet. */
  public get hasActiveTurn(): boolean {
    return this.activeTurn !== undefined;
  }

  /** Determine whether a start request may reuse this listening instance. */
  public canReuse(port: number | undefined): boolean {
    return (
      this.state === "running" &&
      this.handle !== undefined &&
      (!port || port === this.handle.port)
    );
  }

  /** Replace request dependencies when an existing port is reused. */
  public updateOptions(options: WebUiOptions): void {
    if (this.state !== "running") {
      throw new Error("Orbit Web UI is not running.");
    }
    this.options = options;
    this.completionFilesPromise = undefined;
  }

  /** Return this instance's live public handle. */
  public getHandle(): WebUiHandle {
    if (this.state !== "running" || !this.handle) {
      throw new Error("Orbit Web UI is not running.");
    }
    return this.handle;
  }

  /** Bind the loopback HTTP server and attach this instance's event bridge. */
  public async start(): Promise<WebUiHandle> {
    if (this.state !== "idle") {
      throw new Error("A Web UI runtime instance can only be started once.");
    }
    this.state = "starting";
    this.token = randomBytes(32).toString("base64url");
    const preferredPort = this.options.port ?? 6047;
    const attempts =
      preferredPort === 0
        ? [0]
        : Array.from({ length: 20 }, (_, index) => preferredPort + index);
    let lastError: unknown;

    for (const port of attempts) {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((error: unknown) => {
          sendJson(res, 500, { ok: false, message: safeWebMessage(error) });
        });
      });
      try {
        const actualPort = await listen(server, port);
        const token = this.token;
        if (!token) throw new Error("Orbit Web UI authentication failed.");
        this.server = server;
        this.state = "running";
        this.events.start();
        const handle: WebUiHandle = {
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}/#token=${encodeURIComponent(token)}`,
          close: () => this.stop(),
        };
        this.handle = handle;
        return handle;
      } catch (error: unknown) {
        lastError = error;
        if (
          !isNodeError(error) ||
          error.code !== "EADDRINUSE" ||
          preferredPort === 0
        ) {
          this.token = undefined;
          this.state = "stopped";
          throw error;
        }
      }
    }

    this.token = undefined;
    this.state = "stopped";
    throw lastError instanceof Error
      ? lastError
      : new Error("Unable to start Orbit Web UI.");
  }

  /**
   * Permanently stop this instance. Outstanding prompt promises may settle,
   * but their completion events remain confined to this stopped runtime.
   */
  public stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  private async stopInternal(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    this.events.stop();
    this.activeTurn = undefined;
    this.token = undefined;
    this.handle = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
    this.state = "stopped";
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (this.state !== "running") {
      sendJson(res, 503, { error: "Orbit Web UI is not initialized." });
      return;
    }
    const options = this.options;
    const token = this.token;
    const host = req.headers.host || "";
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
      sendJson(res, 403, { error: "Invalid Host header." });
      return;
    }
    // The Host header is validated above, so request routing does not need to
    // incorporate it into the URL base. A fixed loopback base also keeps URL
    // parsing stable across browser/proxy variants that preserve an absolute
    // request target.
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(
        res,
        200,
        renderWebUiPage(options.config.language === "zh" ? "zh" : "en"),
        token,
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/orbit.css") {
      sendAsset(res, "text/css", WEB_UI_STYLES);
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/orbit.js") {
      sendAsset(res, "text/javascript", WEB_UI_CLIENT_SCRIPT);
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/orbit-mark.svg") {
      sendAsset(res, "image/svg+xml", WEB_UI_FAVICON_SVG);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/bootstrap") {
      if (!isBearerAuthorizedWebRequest(req, token)) {
        sendJson(res, 401, { error: "Unauthorized." });
        return;
      }
      bootstrapWebSession(res, token || "");
      return;
    }
    const isEventStream =
      req.method === "GET" && url.pathname === "/api/events";
    const isAuthorized = isEventStream
      ? isAuthorizedWebRequest(req, token) ||
        isAuthorizedWebEventRequest(req, token, url)
      : isAuthorizedWebRequest(req, token);
    if (!isAuthorized) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }
    if (
      req.method === "POST" &&
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      sendJson(res, 415, { error: "Content-Type must be application/json." });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, collectWebUiStatus(options, this.activeTurn));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/messages") {
      sendJson(res, 200, { messages: collectWebUiMessages(options.loop) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, collectWebUiSettings(options));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/completions") {
      const query = CompletionQuerySchema.safeParse(
        url.searchParams.get("query") || "",
      );
      if (!query.success) {
        sendJson(res, 400, { error: "Invalid completion query." });
        return;
      }
      const files = await this.getCompletionFiles(options);
      sendJson(res, 200, {
        files: filterWebUiCompletionFiles(files, query.data),
        total: files.length,
      });
      return;
    }
    if (isEventStream) {
      this.events.attach(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      await this.handleChat(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      await this.handleSettings(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session") {
      await this.handleSession(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/project") {
      await this.handleProject(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cancel") {
      await this.handleCancel(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/approval") {
      await this.handleApproval(req, res, options);
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  }

  private async handleApproval(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.respondToApproval) {
      sendJson(res, 409, {
        ok: false,
        message: "Approval bridge is not available.",
      });
      return;
    }
    try {
      const decision = ApprovalDecisionSchema.parse(await readJsonBody(req));
      const result = sanitizeActionResult(
        await options.respondToApproval(decision),
      );
      sendJson(res, result.ok ? 200 : 409, result);
    } catch (error) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleProject(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.openProject) {
      sendJson(res, 409, {
        ok: false,
        message: "Project launcher is not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before opening a project.",
      });
      return;
    }
    try {
      const action = ProjectActionSchema.parse(await readJsonBody(req));
      const result = sanitizeProjectActionResult(
        await options.openProject(action),
      );
      sendJson(
        res,
        result.ok
          ? action.action === "remove" || action.action === "pick"
            ? 200
            : 202
          : 400,
        result,
      );
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private getCompletionFiles(options: WebUiOptions): Promise<string[]> {
    if (!this.completionFilesPromise) {
      this.completionFilesPromise = getAutocompleteCandidates(
        options.cwd,
        options.config,
      ).then((candidates) =>
        candidates.files.slice(0, options.config.context.maxFilesToIndex),
      );
    }
    return this.completionFilesPromise;
  }

  private async handleChat(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.submitPrompt) {
      sendJson(res, 409, {
        ok: false,
        message: "Chat bridge is not available.",
      });
      return;
    }
    try {
      const body = ChatRequestSchema.parse(await readJsonBody(req));
      if (this.activeTurn) {
        sendJson(res, 409, {
          ok: false,
          message: "Orbit is already processing a request.",
          turnId: this.activeTurn.id,
        });
        return;
      }
      const turn: ActiveWebTurn = {
        id: body.turnId || randomUUID(),
        sessionId: safeCall(() => options.loop?.getSessionId?.()) || "",
        startedAt: new Date().toISOString(),
        cancelRequested: false,
      };
      this.activeTurn = turn;
      this.events.broadcast({
        kind: "turn_started",
        turnId: turn.id,
        sessionId: turn.sessionId,
        startedAt: turn.startedAt,
      });
      sendJson(res, 202, { ok: true, turnId: turn.id });
      void this.runWebTurn(options, turn, body.prompt);
    } catch (error) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async runWebTurn(
    options: WebUiOptions,
    turn: ActiveWebTurn,
    prompt: string,
  ): Promise<void> {
    let status: "completed" | "failed" | "aborted" = "completed";
    let message: string | undefined;
    try {
      const result = await options.submitPrompt?.(prompt);
      if (turn.cancelRequested) {
        status = "aborted";
      } else if (!result?.ok) {
        status = "failed";
        message = safeWebMessage(
          result?.message || "Orbit could not complete the request.",
        );
      }
    } catch (error: unknown) {
      status = turn.cancelRequested ? "aborted" : "failed";
      message = safeWebMessage(error);
    } finally {
      if (this.activeTurn === turn) this.activeTurn = undefined;
      this.events.broadcast({
        kind: "turn_done",
        turnId: turn.id,
        sessionId: turn.sessionId,
        status,
        ok: status === "completed",
        ...(message ? { message } : {}),
      });
    }
  }

  private async handleSettings(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.updateSettings) {
      sendJson(res, 409, {
        ok: false,
        message: "Settings bridge is not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before changing settings.",
      });
      return;
    }
    try {
      const patch = SettingsPatchSchema.parse(await readJsonBody(req));
      const result = await options.updateSettings(patch);
      sendJson(res, result.ok ? 200 : 400, sanitizeActionResult(result));
    } catch (error) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleCancel(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    try {
      const body = CancelRequestSchema.parse(await readJsonBody(req));
      const turn = this.activeTurn;
      if (!turn) {
        if (!options.cancelPrompt) {
          sendJson(res, 409, {
            ok: false,
            message: "Nothing is currently running.",
          });
          return;
        }
        const result = await options.cancelPrompt();
        sendJson(res, result.ok ? 200 : 409, sanitizeActionResult(result));
        return;
      }
      if (body.turnId && body.turnId !== turn.id) {
        sendJson(res, 409, {
          ok: false,
          message: "The active turn has changed.",
        });
        return;
      }
      if (!options.cancelPrompt) {
        sendJson(res, 409, {
          ok: false,
          message: "Cancellation is not available.",
        });
        return;
      }
      turn.cancelRequested = true;
      const result = await options.cancelPrompt();
      if (!result.ok && this.activeTurn === turn) {
        turn.cancelRequested = false;
      }
      sendJson(res, result.ok ? 200 : 409, sanitizeActionResult(result));
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleSession(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.updateSession) {
      sendJson(res, 409, {
        ok: false,
        message: "Session navigation is not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before changing sessions.",
      });
      return;
    }
    try {
      const action = SessionActionSchema.parse(await readJsonBody(req));
      const result = await options.updateSession(action);
      sendJson(res, result.ok ? 200 : 409, sanitizeActionResult(result));
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }
}
