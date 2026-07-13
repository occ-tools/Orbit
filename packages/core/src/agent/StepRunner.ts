import { toolRegistry, ToolResult } from "@orbit-build/tools";
import { OrbitToolCall } from "@orbit-build/model-providers";
import type { OrbitConfig } from "@orbit-build/config";

export class StepRunner {
  constructor(
    private cwd: string,
    private sessionId: string,
    private config?: OrbitConfig,
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

    let parsedArgs: unknown;
    let validated:
      | { success: true; data: any }
      | { success: false; error: any };
    try {
      parsedArgs = JSON.parse(toolCall.arguments);
      validated = tool.inputSchema.safeParse(parsedArgs);
    } catch (e: any) {
      return {
        ok: false,
        error: `Tool input JSON parse failed: ${e.message}`,
      };
    }

    if (!validated.success) {
      return {
        ok: false,
        error: `Tool input validation failed: ${validated.error.message}`,
      };
    }

    // Use configured command timeout as the execution upper bound.
    const isExecutionCommand =
      toolCall.name === "bash" || toolCall.name === "run_tests";
    const timeoutMs = isExecutionCommand
      ? this.getExecutionTimeoutMs(validated.data)
      : 120000;

    const timeoutController = new AbortController();

    // Wire up parent abort signal if it exists
    const onAbort = () => {
      timeoutController.abort();
    };
    if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort);
    }

    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    try {
      const result = await tool.execute(validated.data, {
        cwd: this.cwd,
        sessionId: this.sessionId,
        config: this.config,
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
      if (abortSignal) {
        abortSignal.removeEventListener("abort", onAbort);
      }
    }
  }

  private getExecutionTimeoutMs(validatedArgs: any): number {
    const configured = this.config?.tools?.bash?.timeoutMs;
    const configuredTimeout =
      typeof configured === "number" && Number.isFinite(configured)
        ? Math.max(1000, configured)
        : 120000;
    const requested = validatedArgs?.timeoutMs;
    if (typeof requested === "number" && Number.isFinite(requested)) {
      return Math.max(1000, Math.min(requested, configuredTimeout));
    }
    return configuredTimeout;
  }
}
