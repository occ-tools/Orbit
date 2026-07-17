import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import {
  AgentLoop,
  UserInteraction,
  Orchestrator,
  eventBus,
  type AgentLoopRunOutcome,
} from "@orbit-build/core";
import { Prompt, DiffView } from "@orbit-build/tui";
import picocolors from "picocolors";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  previousCodePointIndex,
  nextCodePointIndex,
  parseMouseWheelDirection,
  pageText,
} from "../tui/FullscreenTui.js";
import { ReplController } from "../runtime/ReplController.js";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";
import { redactSecrets } from "@orbit-build/shared";
import type { ModelProvider } from "@orbit-build/model-providers";

export { previousCodePointIndex, nextCodePointIndex, parseMouseWheelDirection };

interface LocalState {
  lastSessionId?: string;
  lastModel?: string;
}

function getLocalState(cwd: string): LocalState {
  const statePath = join(cwd, ".orbit", "state.json");
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

export function shouldUseStoredModel(cliOverrides: unknown): boolean {
  if (
    typeof cliOverrides !== "object" ||
    cliOverrides === null ||
    Array.isArray(cliOverrides)
  ) {
    return true;
  }
  const models = (cliOverrides as Record<string, unknown>).models;
  if (typeof models !== "object" || models === null || Array.isArray(models)) {
    return true;
  }
  const selected = (models as Record<string, unknown>).default;
  return typeof selected !== "string" || selected.trim().length === 0;
}

export interface RunAgentOptions {
  nonInteractive?: boolean;
  jsonl?: boolean;
  webUi?: {
    port?: number;
    open: boolean;
  };
}

export async function runAgent(
  cwd: string,
  task?: string,
  cliOverrides?: Partial<OrbitConfig>,
  multi?: boolean,
  options?: RunAgentOptions,
): Promise<AgentLoopRunOutcome | undefined> {
  const cleanupJsonl = options?.jsonl ? configureJsonlOutput() : () => {};
  try {
    const config = ConfigLoader.loadSync(cwd, cliOverrides);

    if (shouldUseStoredModel(cliOverrides)) {
      const localState = getLocalState(cwd);
      if (localState.lastModel) {
        config.models.default = localState.lastModel;
      }
    }

    if (config.models) {
      if (config.models.default) {
        config.models.default = config.models.default.replace(
          /\x1b\[[0-9;]*[a-zA-Z]/g,
          "",
        );
      }
      if (config.models.fast) {
        config.models.fast = config.models.fast.replace(
          /\x1b\[[0-9;]*[a-zA-Z]/g,
          "",
        );
      }
    }

    let providerInstance: ModelProvider;
    try {
      providerInstance = createProviderFromConfig(config);
    } catch (error: unknown) {
      const message = redactSecrets(
        error instanceof Error
          ? error.message
          : "Failed to create provider instance.",
      );
      console.error(picocolors.red(message));
      const outcome: AgentLoopRunOutcome = {
        status: "failed",
        sessionId: "",
        attempts: 0,
        error: { code: "provider_error", message },
      };
      eventBus.emitEvent("agent_completed", {
        taskId: "startup",
        success: false,
        result: outcome,
        error: message,
      });
      return outcome;
    }

    const interaction: UserInteraction = options?.nonInteractive
      ? {
          async askApproval(
            reason: string,
            preview?: string,
          ): Promise<boolean> {
            console.error(`\nRisk Warning [Non-Interactive Mode]: ${reason}`);
            if (preview) {
              console.error(picocolors.gray(`Parameters: ${preview}`));
            }
            console.error(
              "Automatically denying action in non-interactive mode.",
            );
            return false;
          },
          showText(text: string): void {
            console.error(text);
          },
          async showDiff(
            filePath: string,
            _before: string | null,
            _after: string,
          ): Promise<void> {
            console.error(
              `[Diff for ${filePath} shown in non-interactive mode]`,
            );
          },
        }
      : {
          async askApproval(
            reason: string,
            preview?: string,
          ): Promise<boolean> {
            console.log(`\nRisk Warning: ${reason}`);
            if (preview) {
              console.log(picocolors.gray(`Parameters: ${preview}`));
            }
            return await Prompt.askApproval("Confirm action?");
          },
          showText(text: string): void {
            console.log(text);
          },
          async showDiff(
            filePath: string,
            before: string | null,
            after: string,
          ): Promise<void> {
            await pageText(DiffView.render(filePath, before, after));
          },
        };

    const activeTask = task;
    if (!activeTask) {
      const controller = new ReplController(
        cwd,
        config,
        providerInstance,
        interaction,
        multi,
        !!cliOverrides?.direct,
        options?.webUi,
      );
      await controller.start();
      return;
    }

    if (multi) {
      const orchestrator = new Orchestrator(
        cwd,
        config,
        providerInstance,
        activeTask,
        interaction,
      );
      return await orchestrator.run();
    } else {
      const loop = new AgentLoop(
        cwd,
        config,
        providerInstance,
        activeTask,
        interaction,
        {
          disableStatusBar: !!options?.nonInteractive || !!options?.jsonl,
          nonInteractive: !!options?.nonInteractive,
        },
      );
      return await loop.run();
    }
  } finally {
    cleanupJsonl();
  }
}

/** Maps structured agent outcomes to stable process exit codes. */
export function exitCodeForOutcome(
  outcome: AgentLoopRunOutcome | undefined,
): number {
  if (!outcome || outcome.status === "completed") return 0;
  if (outcome.status === "aborted") return 130;
  if (outcome.error.code === "provider_error") return 4;
  return 2;
}

function configureJsonlOutput(): () => void {
  const originalLog = console.log;
  const onEvent = (event: unknown) => {
    originalLog(JSON.stringify(sanitizeJsonlEvent(event)));
  };
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  eventBus.on("*", onEvent);
  return () => {
    eventBus.off("*", onEvent);
    console.log = originalLog;
  };
}

function sanitizeJsonlEvent(event: unknown): unknown {
  if (!isRecord(event) || typeof event.type !== "string") return {};
  const payload = isRecord(event.payload) ? event.payload : {};
  switch (event.type) {
    case "model_request":
      return { type: event.type, payload: { model: payload.model } };
    case "model_response":
      return {
        type: event.type,
        payload: { model: payload.model, usage: payload.usage },
      };
    case "tool_proposal":
      return {
        type: event.type,
        payload: {
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          explanation: payload.explanation,
        },
      };
    case "tool_result":
      return {
        type: event.type,
        payload: {
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          error:
            typeof payload.error === "string"
              ? redactSecrets(payload.error)
              : payload.error,
        },
      };
    default:
      return redactJsonValue(event);
  }
}

function redactJsonValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactJsonValue(item)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
