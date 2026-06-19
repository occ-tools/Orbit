import { toolRegistry, ToolResult } from "@orbit-ai/tools";
import { OrbitToolCall } from "@orbit-ai/model-providers";

export class StepRunner {
  constructor(
    private cwd: string,
    private sessionId: string,
  ) {}

  public async run(
    toolCall: OrbitToolCall,
    abortSignal?: AbortSignal,
  ): Promise<ToolResult<any>> {
    const tool = toolRegistry.get(toolCall.name);
    if (!tool) {
      return {
        ok: false,
        error: `Tool "${toolCall.name}" not found in registry.`,
      };
    }

    // Set a hard timeout limit of 45 seconds for execution commands (bash/run_tests) to avoid hanging the sandbox
    const isExecutionCommand =
      toolCall.name === "bash" || toolCall.name === "run_tests";
    const timeoutMs = isExecutionCommand ? 45000 : 120000;

    const timeoutController = new AbortController();

    // Wire up parent abort signal if it exists
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        timeoutController.abort();
      });
    }

    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    try {
      const parsedArgs = JSON.parse(toolCall.arguments);
      const validated = tool.inputSchema.safeParse(parsedArgs);
      if (!validated.success) {
        return {
          ok: false,
          error: `Tool input validation failed: ${validated.error.message}`,
        };
      }

      const result = await tool.execute(validated.data, {
        cwd: this.cwd,
        sessionId: this.sessionId,
        abortSignal: timeoutController.signal,
      });

      return result;
    } catch (e: any) {
      if (
        timeoutController.signal.aborted &&
        (!abortSignal || !abortSignal.aborted)
      ) {
        return {
          ok: false,
          error: `Tool execution timed out after ${timeoutMs}ms. Command tree was terminated.`,
        };
      }
      return {
        ok: false,
        error: `Tool execution threw exception: ${e.message}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
