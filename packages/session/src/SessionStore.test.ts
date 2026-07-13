import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SessionStore } from "./SessionStore.js";

describe("SessionStore file logging", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "orbit-session-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create session and append events", () => {
    const store = new SessionStore(tempDir);
    const session = store.createSession("deepseek", "v4-pro");

    expect(session.provider).toBe("deepseek");
    expect(session.model).toBe("v4-pro");

    store.appendEvent(session.id, "user_message", { text: "hello" });
    store.appendEvent(session.id, "assistant_message", { text: "hi" });

    const events = store.getEvents(session.id);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("user_message");
    expect(events[0].payload).toMatchObject({ text: "hello" });
  });

  it("does not touch the filesystem in its constructor", () => {
    const workspace = join(tempDir, "nested-workspace");
    mkdirSync(workspace);

    new SessionStore(workspace);

    expect(existsSync(join(workspace, ".orbit"))).toBe(false);
  });

  it("should create, list, and delete sessions", () => {
    const store = new SessionStore(tempDir);
    expect(() => store.deleteSession("sess_friendly-panda-123")).not.toThrow();
    const session = store.createSession("deepseek", "v4-pro");
    expect(store.listSessions().length).toBe(1);

    store.deleteSession(session.id);
    expect(store.listSessions().length).toBe(0);
  });

  it("validates and round-trips persisted model history", () => {
    const store = new SessionStore(tempDir);
    const session = store.createSession("deepseek", "deepseek-v4-flash");
    const history = [
      {
        id: "msg-context",
        role: "user" as const,
        createdAt: "2026-07-13T00:00:00.000Z",
        content: [{ type: "text" as const, text: "context" }],
        metadata: {
          kind: "orbit_volatile_context",
          forMessageId: "msg-user",
        },
      },
      {
        id: "msg-user",
        role: "user" as const,
        createdAt: "2026-07-13T00:00:01.000Z",
        content: [{ type: "text" as const, text: "hello" }],
      },
    ];

    store.saveHistory(session.id, history);

    expect(store.getHistory(session.id)).toEqual(history);
    const updatedHistory = [
      ...history,
      {
        id: "msg-assistant",
        role: "assistant" as const,
        createdAt: "2026-07-13T00:00:02.000Z",
        content: [{ type: "text" as const, text: "hi" }],
      },
    ];
    store.saveHistory(session.id, updatedHistory);
    expect(store.getHistory(session.id)).toEqual(updatedHistory);
    expect(() =>
      store.saveHistory(session.id, [{ role: "user", content: [] }]),
    ).toThrow();
    expect(store.getHistory(session.id)).toEqual(updatedHistory);
    expect(
      readdirSync(join(tempDir, ".orbit", "sessions", session.id)).filter(
        (file) => file.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("ignores malformed history files at the external boundary", () => {
    const store = new SessionStore(tempDir);
    const session = store.createSession("deepseek", "deepseek-v4-flash");
    const historyFile = join(
      tempDir,
      ".orbit",
      "sessions",
      session.id,
      "history.json",
    );
    writeFileSync(historyFile, JSON.stringify([{ role: "assistant" }]), "utf8");

    expect(store.getHistory(session.id)).toEqual([]);
  });

  it("rejects unsafe or non-JSON history metadata without replacing history", () => {
    const store = new SessionStore(tempDir);
    const session = store.createSession("deepseek", "deepseek-v4-flash");
    const validHistory = [
      {
        id: "msg-user",
        role: "user",
        createdAt: "2026-07-13T00:00:00.000Z",
        content: [{ type: "text", text: "hello" }],
      },
    ];
    store.saveHistory(session.id, validHistory);

    const unsafeMetadata: unknown = JSON.parse(
      '{"__proto__":{"polluted":true}}',
    );
    expect(() =>
      store.saveHistory(session.id, [
        {
          ...validHistory[0],
          metadata: unsafeMetadata,
        },
      ]),
    ).toThrow();
    expect(() =>
      store.saveHistory(session.id, [
        {
          ...validHistory[0],
          metadata: { invalid: BigInt(1) },
        },
      ]),
    ).toThrow();
    expect(() =>
      store.saveHistory(session.id, [
        {
          id: "msg-tool-call",
          role: "assistant",
          createdAt: "2026-07-13T00:00:01.000Z",
          content: [
            {
              type: "tool_call",
              toolCall: {
                id: "tc-invalid",
                name: "shell",
                arguments: "{invalid-json",
              },
            },
          ],
        },
      ]),
    ).toThrow();
    expect(store.getHistory(session.id)).toEqual(validHistory);
  });

  it("skips corrupt and cross-session event log lines", () => {
    const store = new SessionStore(tempDir);
    const session = store.createSession("deepseek", "deepseek-v4-flash");
    const otherSession = store.createSession("deepseek", "deepseek-v4-flash");
    store.appendEvent(session.id, "valid_event", { ok: true });
    const eventFile = join(
      tempDir,
      ".orbit",
      "sessions",
      session.id,
      "events.jsonl",
    );
    appendFileSync(
      eventFile,
      [
        "not-json",
        JSON.stringify({
          id: "evt_cross_session",
          sessionId: otherSession.id,
          type: "foreign_event",
          payload: null,
          createdAt: "2026-07-13T00:00:00.000Z",
        }),
        JSON.stringify({
          id: "evt_invalid_date",
          sessionId: session.id,
          type: "invalid_event",
          payload: null,
          createdAt: "yesterday",
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    expect(store.getEvents(session.id).map((event) => event.type)).toEqual([
      "valid_event",
    ]);
  });

  it("rejects traversal session ids before deleting anything", () => {
    const store = new SessionStore(tempDir);
    const outside = join(tempDir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "keep", "utf8");

    expect(() => store.deleteSession("../../outside")).toThrow(
      /Invalid Orbit session id/,
    );
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });

  it("ignores a session file whose id does not match its directory", () => {
    const store = new SessionStore(tempDir);
    const session = store.createSession("deepseek", "v4-pro");
    const sessionFile = join(
      tempDir,
      ".orbit",
      "sessions",
      session.id,
      "session.json",
    );
    writeFileSync(
      sessionFile,
      JSON.stringify({ ...session, id: "sess_friendly-panda-123" }),
      "utf8",
    );

    expect(store.getSession(session.id)).toBeUndefined();
    expect(store.listSessions()).toEqual([]);
  });

  it("refuses to recursively delete a symbolic-link session directory", () => {
    const store = new SessionStore(tempDir);
    const root = join(tempDir, ".orbit", "sessions");
    const outside = join(tempDir, "outside-session");
    const id = "sess_friendly-panda-123";
    mkdirSync(root, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "keep", "utf8");

    try {
      symlinkSync(
        outside,
        join(root, id),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      return;
    }

    expect(() => store.deleteSession(id)).toThrow();
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });

  it("rejects a session root redirected outside the workspace", () => {
    const orbitDir = join(tempDir, ".orbit");
    const outside = join(tempDir, "..", `outside-${Date.now()}`);
    mkdirSync(orbitDir);
    mkdirSync(outside);

    try {
      symlinkSync(
        outside,
        join(orbitDir, "sessions"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    try {
      const store = new SessionStore(tempDir);
      expect(() =>
        store.createSession("deepseek", "deepseek-v4-flash"),
      ).toThrow(/outside workspace boundary|real directory/);
      expect(store.listSessions()).toEqual([]);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("validates creation and updates before replacing session metadata", () => {
    const store = new SessionStore(tempDir);
    expect(() => store.createSession("", "deepseek-v4-flash")).toThrow();
    expect(existsSync(join(tempDir, ".orbit"))).toBe(false);

    const session = store.createSession("deepseek", "deepseek-v4-flash");
    expect(() =>
      store.updateSession({ ...session, totalInputTokens: -1 }),
    ).toThrow();
    expect(store.getSession(session.id)).toEqual(session);
    store.updateSession({ ...session, totalInputTokens: 2 });
    expect(store.getSession(session.id)?.totalInputTokens).toBe(2);
    expect(
      readdirSync(join(tempDir, ".orbit", "sessions", session.id)).filter(
        (file) => file.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });
});
