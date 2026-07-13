import fs from "fs";
import path from "path";
import { existsSync, statSync } from "fs";
import { z } from "zod";
import type { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { WorktreeManager, type WorktreeSession } from "@orbit-build/sandbox";
import { generateId, redactSecrets } from "@orbit-build/shared";
import { eventBus } from "../events/EventBus.js";
import {
  AgentLoop,
  type AgentLoopRunOutcome,
  type UserInteraction,
} from "./AgentLoop.js";

const ReviewVerdictSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  feedback: z.string().default(""),
});

type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export class Orchestrator {
  private currentLoop: AgentLoop | null = null;
  private aborted = false;

  constructor(
    private cwd: string,
    private config: OrbitConfig,
    private provider: ModelProvider,
    private task: string,
    private interaction: UserInteraction,
  ) {}

  public abort(mode: "prompt" | "immediate" = "prompt"): void {
    this.aborted = true;
    this.currentLoop?.abort(mode);
  }

  public async run(): Promise<AgentLoopRunOutcome> {
    if (this.aborted) {
      return this.abortedOutcome(
        0,
        "Orchestration was aborted before it started.",
      );
    }

    eventBus.emitEvent("agent_start", {
      taskId: "multi-agent-session",
      task: this.task,
    });
    this.interaction.showText("\n● Starting Multi-Agent Orchestration Flow...");

    const planner = await this.runPlanner();
    if (planner.outcome.status !== "completed") return planner.outcome;
    if (this.aborted) {
      return this.abortedOutcome(0, "Orchestration was interrupted.");
    }
    const planText = planner.plan;
    this.persistPlan(planText);

    const worktrees = new WorktreeManager(this.cwd);
    let worktree: WorktreeSession | undefined;
    let agentCwd = this.cwd;
    let mergeFailed = false;
    let mergeFailureMessage = "";
    let completed = false;
    let completedAttempts = 0;

    if (worktrees.isGitRepo()) {
      try {
        const worktreeId = generateId("wt").slice(0, 12);
        worktree = worktrees.createWorktree(worktreeId);
        if (
          !existsSync(worktree.path) ||
          !statSync(worktree.path).isDirectory()
        ) {
          throw new Error(
            `Worktree manager returned a missing directory: ${worktree.path}`,
          );
        }
        agentCwd = worktree.path;
        this.interaction.showText(
          `  ● Running Coder and Reviewer in isolated git worktree: ${agentCwd}`,
        );
      } catch (error: unknown) {
        if (worktree) {
          try {
            worktrees.discardWorktree(worktree);
          } catch {
            // Best-effort cleanup before falling back to the main workspace.
          }
          worktree = undefined;
        }
        agentCwd = this.cwd;
        this.interaction.showText(
          `  ⚠️ Worktree unavailable; falling back to the main workspace: ${errorMessage(error)}`,
        );
      }
    } else {
      this.interaction.showText(
        "  ⚠️ Git is unavailable; Coder and Reviewer will use the main workspace.",
      );
    }

    let feedback = "";
    const maxAttempts = 3;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (this.aborted) break;
        const coderOutcome = await this.runCoder(
          agentCwd,
          planText,
          feedback,
          attempt,
          maxAttempts,
        );
        if (coderOutcome.status !== "completed") return coderOutcome;
        if (this.aborted) break;

        const review = await this.runReviewer(agentCwd, attempt, maxAttempts);
        if (review.outcome.status !== "completed") return review.outcome;
        if (review.verdict !== "approved") {
          feedback = review.feedback || "Reviewer rejected the implementation.";
          this.interaction.showText(
            `\n✖ Review rejected attempt ${attempt}/${maxAttempts}: ${feedback}`,
          );
          continue;
        }

        if (worktree) {
          this.interaction.showText(
            "  ● Review approved. Merging verified changes into the main workspace...",
          );
          const mergeResult = worktrees.mergeAndCleanup(worktree);
          if (!mergeResult.success) {
            mergeFailed = true;
            mergeFailureMessage =
              mergeResult.error ||
              mergeResult.conflictFiles?.join(", ") ||
              "unknown merge error";
            this.interaction.showText(
              `  ✖ Merge failed; worktree was preserved at ${worktree.path}: ${errorMessage(mergeFailureMessage)}`,
            );
            break;
          }
          worktree = undefined;
        }

        completed = true;
        completedAttempts = attempt;
        this.interaction.showText(
          "\n✔ Review and merge gates passed. Multi-agent task completed successfully.",
        );
        break;
      }
    } finally {
      this.currentLoop = null;
      if (worktree && !mergeFailed) {
        try {
          worktrees.discardWorktree(worktree);
        } catch (error: unknown) {
          this.interaction.showText(
            `  ⚠️ Failed to clean temporary worktree: ${errorMessage(error)}`,
          );
        }
      }
    }

    if (!completed && !mergeFailed && !this.aborted) {
      this.interaction.showText(
        `\n✖ Orchestration stopped after ${maxAttempts} rejected attempts; no isolated changes were merged.`,
      );
    }

    if (completed) {
      return {
        status: "completed",
        sessionId: "multi-agent-session",
        attempts: completedAttempts,
      };
    }
    if (this.aborted) {
      return this.abortedOutcome(
        completedAttempts,
        "Orchestration was interrupted.",
      );
    }
    return this.failedOutcome(
      completedAttempts || maxAttempts,
      mergeFailed
        ? `Failed to merge the reviewed worktree: ${errorMessage(mergeFailureMessage)}`
        : `Orchestration stopped after ${maxAttempts} rejected review attempts.`,
    );
  }

  private async runPlanner(): Promise<{
    plan: string;
    outcome: AgentLoopRunOutcome;
  }> {
    this.interaction.showText(
      "\n[Phase 1: Planning] Initializing Planner Agent...",
    );
    const loop = new AgentLoop(
      this.cwd,
      this.config,
      this.provider,
      `Create a detailed implementation plan for: ${this.task}`,
      this.interaction,
      {
        modelOverride: this.config.models.planner,
        systemPromptOverride: `You are the Orbit Planner Agent.
Analyze the codebase and produce a detailed implementation plan.
Do not modify files. Return the plan as plain text.`,
        allowedTools: [
          "read_file",
          "list_files",
          "glob",
          "grep",
          "git_status",
          "git_diff",
          "detect_project",
          "inspect_project",
        ],
      },
    );
    this.currentLoop = loop;
    try {
      const outcome = await loop.run();
      return {
        plan: lastAssistantText(loop) || "No plan generated.",
        outcome,
      };
    } finally {
      this.currentLoop = null;
    }
  }

  private async runCoder(
    cwd: string,
    plan: string,
    feedback: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<AgentLoopRunOutcome> {
    this.interaction.showText(
      `\n[Phase 2: Coding ${attempt}/${maxAttempts}] Initializing Coder Agent...`,
    );
    const prompt = feedback
      ? `Repair the implementation using this reviewer feedback:\n${feedback}\n\nOriginal plan:\n${plan}`
      : `Implement the following plan:\n${plan}`;
    const loop = new AgentLoop(
      cwd,
      this.config,
      this.provider,
      prompt,
      this.interaction,
      {
        modelOverride: this.config.models.coder,
        systemPromptOverride: `You are the Orbit Coder Agent.
Make precise changes in the current isolated workspace. Do not commit or merge.`,
        allowedTools: [
          "read_file",
          "write_file",
          "edit_file",
          "list_files",
          "glob",
          "grep",
          "git_status",
          "git_diff",
        ],
      },
    );
    this.currentLoop = loop;
    try {
      return await loop.run();
    } finally {
      this.currentLoop = null;
    }
  }

  private async runReviewer(
    cwd: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<ReviewVerdict & { outcome: AgentLoopRunOutcome }> {
    this.interaction.showText(
      `\n[Phase 3: Review ${attempt}/${maxAttempts}] Initializing Reviewer Agent...`,
    );
    const loop = new AgentLoop(
      cwd,
      this.config,
      this.provider,
      "Review the current worktree diff and run the relevant verification tasks.",
      this.interaction,
      {
        modelOverride: this.config.models.reviewer,
        systemPromptOverride: `You are the Orbit Reviewer Agent.
Review the current workspace diff and run tests when available. Do not edit files.
Your final response must be one JSON object with this exact shape:
{"verdict":"approved"|"rejected","feedback":"concise explanation"}`,
        allowedTools: [
          "read_file",
          "list_files",
          "glob",
          "grep",
          "git_status",
          "git_diff",
          "run_tests",
          "bash",
        ],
      },
    );
    this.currentLoop = loop;
    try {
      const outcome = await loop.run();
      return { ...parseReviewVerdict(lastAssistantText(loop)), outcome };
    } finally {
      this.currentLoop = null;
    }
  }

  private abortedOutcome(
    attempts: number,
    message: string,
  ): AgentLoopRunOutcome {
    return {
      status: "aborted",
      sessionId: "multi-agent-session",
      attempts,
      reason: "interrupted",
      message,
    };
  }

  private failedOutcome(
    attempts: number,
    message: string,
  ): AgentLoopRunOutcome {
    return {
      status: "failed",
      sessionId: "multi-agent-session",
      attempts,
      error: {
        code: "execution_error",
        message: errorMessage(message),
      },
    };
  }

  private persistPlan(plan: string): void {
    try {
      const planPath = path.join(this.cwd, ".orbit", "task.md");
      fs.mkdirSync(path.dirname(planPath), { recursive: true });
      fs.writeFileSync(planPath, plan, "utf8");
      this.interaction.showText("  ✔ Plan saved to .orbit/task.md");
    } catch (error: unknown) {
      this.interaction.showText(
        `  ⚠️ Failed to persist plan: ${errorMessage(error)}`,
      );
    }
  }
}

function lastAssistantText(loop: AgentLoop): string {
  const history = loop.getHistory();
  const message = [...history]
    .reverse()
    .find((item) => item.role === "assistant");
  return (
    message?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim() || ""
  );
}

function parseReviewVerdict(text: string): ReviewVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      verdict: "rejected",
      feedback: "Reviewer did not return a structured verdict.",
    };
  }
  try {
    const parsed = ReviewVerdictSchema.safeParse(JSON.parse(match[0]));
    return parsed.success
      ? parsed.data
      : {
          verdict: "rejected",
          feedback: `Invalid reviewer verdict: ${parsed.error.message}`,
        };
  } catch (error: unknown) {
    return {
      verdict: "rejected",
      feedback: `Invalid reviewer JSON: ${errorMessage(error)}`,
    };
  }
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}
