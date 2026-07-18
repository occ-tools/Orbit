# Agent runtime map

The agent directory owns model orchestration and turn state. Keep provider
protocol details in `model-providers`, tool implementations in `tools`, and UI
state in `cli`/`tui`; this folder coordinates those capabilities.

## Main flow

- `AgentLoop.ts` owns one persisted chat's execution lifecycle, approvals,
  checkpoints, verification, context compaction, and public session controls.
- `Orchestrator.ts` coordinates higher-level task execution and worker flows.
- `Planner.ts` and `StepRunner.ts` turn a task into recoverable execution steps.
- `MessageBuilder.ts` constructs stable model messages and volatile project
  context without exposing internal messages to normal chat history.
- `ContextWindowManager.ts` calculates model-aware budgets and compacts history.
- `ModelRouter.ts` selects an appropriate model while preserving the active
  chat and provider state.
- `PromptCacheSlab.ts` keeps the reusable DeepSeek prompt prefix stable and
  records measured cache telemetry.

## Focused support modules

- `AgentToolProtocol.ts`: native/XML tool instructions and XML fallback parsing.
- `AgentTextTransforms.ts`: SEARCH/replace parsing, path extraction, and bounded
  verification-log cleanup.
- `AgentAudit.ts`: file-mutation classification, hashes, and bounded audit diffs.
- `LocalPackageBinary.ts`: safe resolution and execution of workspace-local
  formatter, linter, and test binaries.

These helpers are deliberately stateless. Add pure parsing and formatting logic
there instead of extending `AgentLoop.ts`. Keep filesystem, approval, session,
and model lifecycle decisions in the loop so their ordering remains explicit.

## Verification

```powershell
pnpm exec vitest run packages/core/src/agent
pnpm --filter "@orbit-build/core..." build
pnpm verify
```

New behavior needs a colocated `*.test.ts`. Preserve `.js` suffixes on internal
ESM imports and avoid exporting support helpers unless another package has a
real use for them.
