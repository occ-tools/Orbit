import { z } from "zod";
import { OrbitTool, ToolContext, ToolResult } from "../types.js";
import { WebSearchTool } from "./search.js";

export const WeatherInputSchema = z.object({
  location: z
    .string()
    .min(1)
    .describe("City or place name, for example Hangzhou or 杭州."),
  date: z
    .string()
    .optional()
    .describe(
      "Optional requested date, preferably YYYY-MM-DD. Use today/tomorrow/yesterday only after resolving against Runtime Context when possible.",
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe("Optional forecast days when no explicit date is requested."),
});

export type WeatherInput = z.infer<typeof WeatherInputSchema>;

export class WeatherTool implements OrbitTool<WeatherInput, string> {
  name = "weather";
  description =
    "Get current or dated weather using the direct no-key Open-Meteo source. Prefer this over web_search for weather, temperature, rain, forecast, or historical weather questions.";
  inputSchema = WeatherInputSchema;
  risk = "network" as const;

  private readonly searchTool = new WebSearchTool();

  async execute(
    input: WeatherInput,
    ctx: ToolContext,
  ): Promise<ToolResult<string>> {
    const datePart = input.date ? ` ${input.date}` : " today";
    const query = `${input.location}${datePart} weather forecast temperature rain`;
    return this.searchTool.execute(
      {
        query,
        maxResults: input.days || 5,
      },
      ctx,
    );
  }
}
