import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "./utils.js";

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
