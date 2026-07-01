import { ConfigLoader } from "@orbit-build/config";
import {
  AgentLoop,
  UserInteraction,
  Orchestrator,
  eventBus,
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

export async function runAgent(
  cwd: string,
  task?: string,
  cliOverrides?: any,
  multi?: boolean,
  options?: { nonInteractive?: boolean; jsonl?: boolean },
): Promise<void> {
  if (options?.jsonl) {
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      console.error(...args);
    };
    eventBus.on("*", (event) => {
      originalLog(JSON.stringify(event));
    });
  }

  const config = ConfigLoader.loadSync(cwd, cliOverrides);

  if (!cliOverrides || !cliOverrides.model) {
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

  let providerInstance: any;
  try {
    providerInstance = createProviderFromConfig(config);
  } catch (error: any) {
    console.error(
      picocolors.red(error?.message || "Failed to create provider instance."),
    );
    return;
  }

  const interaction: UserInteraction = options?.nonInteractive
    ? {
        async askApproval(reason: string, preview?: string): Promise<boolean> {
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
          console.error(`[Diff for ${filePath} shown in non-interactive mode]`);
        },
      }
    : {
        async askApproval(reason: string, preview?: string): Promise<boolean> {
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
    await orchestrator.run();
  } else {
    const loop = new AgentLoop(
      cwd,
      config,
      providerInstance,
      activeTask,
      interaction,
      {
        detachBackgroundCachePrimer: !!options?.nonInteractive,
        disableStatusBar: !!options?.nonInteractive || !!options?.jsonl,
      },
    );
    await loop.run();
  }
}
