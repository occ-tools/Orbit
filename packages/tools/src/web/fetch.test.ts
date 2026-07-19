import { describe, expect, it, vi } from "vitest";
import { assertPublicHttpUrl, WebFetchTool } from "./fetch.js";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);

describe("WebFetchTool", () => {
  it("blocks local targets and URL credentials before fetching", async () => {
    await expect(assertPublicHttpUrl("http://localhost/admin")).rejects.toThrow(
      "Local and private",
    );
    await expect(
      assertPublicHttpUrl("https://user:secret@example.com/", publicResolver),
    ).rejects.toThrow("credentials");
  });

  it("returns bounded readable page text without scripts", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          "<html><head><style>.x{}</style></head><body><h1>Orbit Docs</h1><script>secret()</script><p>Useful text &amp; examples.</p></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      publicResolver,
    );

    const result = await tool.execute(
      { url: "https://example.com/docs", maxChars: 1000 },
      { cwd: process.cwd(), sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toContain("Orbit Docs");
    expect(result.data).toContain("Useful text & examples.");
    expect(result.data).not.toContain("secret()");
  });

  it("revalidates redirects and blocks redirects into localhost", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        }),
    );
    const tool = new WebFetchTool(
      fetchImplementation as unknown as typeof fetch,
      publicResolver,
    );

    const result = await tool.execute(
      { url: "https://example.com/redirect" },
      { cwd: process.cwd(), sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("private");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
