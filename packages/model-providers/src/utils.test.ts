import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fetchWithRetry, zodToJsonSchema } from "./utils.js";

describe("zodToJsonSchema", () => {
  it("preserves descriptions, required fields, enums, and numeric bounds", () => {
    const schema = z
      .object({
        query: z.string().min(1).describe("Live search query."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum result count."),
        provider: z
          .enum(["auto", "bing", "duckduckgo"])
          .default("auto")
          .describe("Search backend."),
      })
      .describe("Search input.");

    const json = zodToJsonSchema(schema);

    expect(json).toMatchObject({
      type: "object",
      description: "Search input.",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "Live search query.",
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Maximum result count.",
        },
        provider: {
          type: "string",
          enum: ["auto", "bing", "duckduckgo"],
          description: "Search backend.",
        },
      },
    });
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("honors Retry-After seconds on transient provider responses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const responsePromise = fetchWithRetry(
      "https://provider.example.test/chat",
      { timeout: 10000 },
      1,
    );

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
