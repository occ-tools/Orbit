import { ConfigLoader } from "@orbit-build/config";
import picocolors from "picocolors";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";

export async function runBench(
  cwd: string,
  options: { prompt?: string; model?: string } = {},
): Promise<void> {
  const config = ConfigLoader.loadSync(cwd);
  const provider = createProviderFromConfig(config);
  const model = options.model || config.models.fast || config.models.default;
  const prompt =
    options.prompt ||
    "Reply with one concise sentence explaining what Orbit is.";

  const startedAt = Date.now();
  let firstDeltaMs: number | undefined;
  let textChars = 0;
  let outputTokens = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheMissTokens = 0;
  let error: string | undefined;

  const stream = provider.chat({
    model,
    messages: [
      {
        id: `msg_bench_${Date.now()}`,
        role: "user",
        createdAt: new Date().toISOString(),
        content: [{ type: "text", text: prompt }],
      },
    ],
    tools: [],
    stream: true,
    maxTokens: 96,
  });

  for await (const event of stream) {
    if (event.type === "text_delta" || event.type === "thinking_delta") {
      if (firstDeltaMs === undefined) {
        firstDeltaMs = Date.now() - startedAt;
      }
      textChars += event.text.length;
    } else if (event.type === "usage") {
      inputTokens = event.usage.inputTokens || 0;
      outputTokens = event.usage.outputTokens || 0;
      cacheReadTokens = event.usage.cacheReadTokens || 0;
      cacheMissTokens = event.usage.cacheMissTokens || 0;
    } else if (event.type === "error") {
      error = event.error?.message || String(event.error);
      break;
    }
  }

  const totalMs = Math.max(1, Date.now() - startedAt);
  const tps = outputTokens > 0 ? outputTokens / (totalMs / 1000) : 0;
  const cacheInput = cacheReadTokens + cacheMissTokens || inputTokens;
  const cacheHitRate = cacheInput > 0 ? cacheReadTokens / cacheInput : 0;

  console.log(picocolors.bold("Orbit Bench"));
  console.log(`Provider: ${picocolors.cyan(provider.id)}`);
  console.log(`Model: ${picocolors.cyan(model)}`);
  console.log(`First delta: ${firstDeltaMs ?? "n/a"}ms`);
  console.log(`Total: ${totalMs}ms`);
  console.log(`Output: ${outputTokens || "n/a"} tokens, ${textChars} chars`);
  console.log(`Throughput: ${tps ? tps.toFixed(1) : "n/a"} tokens/sec`);
  console.log(
    `Cache: ${Math.round(cacheHitRate * 100)}% (${cacheReadTokens}/${cacheInput})`,
  );
  if (error) {
    console.log(picocolors.red(`Error: ${error}`));
  }
}
