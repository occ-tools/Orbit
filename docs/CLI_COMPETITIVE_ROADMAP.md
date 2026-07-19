# Orbit CLI Competitive Roadmap

Last reviewed: 2026-07-19

## Product objective

Orbit should not claim to be the best CLI based on feature count. It should win on measurable engineering outcomes:

1. Higher task completion rate on real repositories.
2. Fewer unsafe or unintended changes.
3. Faster recovery from failed agent actions.
4. Better long-session context quality.
5. Lower latency and model cost for equivalent outcomes.
6. Stronger automation, extension, and team-governance surfaces.

The comparison baseline includes current public capabilities documented by Codex CLI, Claude Code, Gemini CLI, Aider, OpenCode, Goose, Qwen Code, and other observable coding-agent CLIs. Products without complete public documentation should be evaluated through reproducible black-box workflows rather than assumed feature claims.

## Current Orbit advantages

- Local-first provider abstraction across DeepSeek, OpenAI, Anthropic, and Ollama.
- DeepSeek V4 automatic stable-prefix cache telemetry and cache-aware cost visibility without synthetic keepalive traffic.
- Hybrid repository context with symbols, PageRank landmarks, BM25/vector retrieval, and reference expansion.
- Workspace path-boundary utilities and protected-path policy.
- Read-only context references enforced during tool execution.
- Persistent sessions, command history, context controls, and session forking.
- Interactive steering while an agent is running.
- Persistent file checkpoints with `/timeline`, `/rewind`, and `/rollback`.
- Project and user custom prompt commands under `.orbit/commands/` and `~/.orbit/commands/`.
- Permission-aware direct shell and Git commands.
- Chinese and English terminal UI.

## Delivery status and highest-priority gaps

| Priority | Capability                 | Current state                                                                                                                                                                                       | Required outcome                                                                                                                                        |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Parallel subagents         | A one-shot dependency DAG scheduler now provides bounded concurrency, normalized scope ownership, graph-wide timeout cancellation, and isolated writer/reviewer orchestration                       | Add durable agent threads, per-agent token/cost budgets, merge-aware write ownership, and visible approval ownership                                    |
| Done     | Non-interactive automation | `orbit exec` provides JSONL events, schema versions, deterministic exit codes, resume, output-schema validation, and CI-safe approvals                                                              | Preserve compatibility and add fixtures when the event schema evolves                                                                                   |
| Done     | Verification contracts     | Build/test/lint/typecheck/security/file-limit/artifact policies are first-class and persisted                                                                                                       | Expand contract presets from measured customer repositories                                                                                             |
| Done     | Full audit trail           | Secret-redacted trace export covers prompts, routing, tools, approvals, diffs, checkpoints, verification, timing, and cost                                                                          | Maintain redaction regression tests and schema compatibility                                                                                            |
| Done     | Agent isolation            | Orchestration uses temporary Git worktrees with merge/conflict handling and safe fallback                                                                                                           | Require isolation for future parallel writers and keep cleanup tests cross-platform                                                                     |
| P1       | Hook system                | Only pre-edit and post-edit command hooks                                                                                                                                                           | Typed lifecycle hooks for session, prompt, permission, pre/post tool, compact, verification, subagent, and stop events                                  |
| P1       | Plugin and skill system    | A versioned, workspace-bound extension manifest validates compatibility, permissions, commands, skills, agents, tools, hooks, MCP servers, and templates; installation/loading is not yet automatic | Signed installation, trust policy, lifecycle loading, updates, and removal without weakening the existing permission engine                             |
| P1       | MCP completeness           | Validated STDIO tool discovery, bounded I/O, per-tool risk, and runtime cleanup are supported                                                                                                       | Streaming HTTP transport, OAuth, resources, prompts, reconnect policy, health state, collision policy, and per-server permissions                       |
| P1       | Code review product        | Reviewer role exists only in orchestration                                                                                                                                                          | Dedicated `/review` presets for uncommitted work, commits, branches, security, tests, accessibility, and custom policy                                  |
| P1       | Multimodal input           | Text-only primary workflow                                                                                                                                                                          | Image attachment, clipboard paste, screenshot context, image-aware provider capability negotiation, and transcript persistence                          |
| P1       | TUI power-user controls    | Strong custom TUI, limited customization                                                                                                                                                            | Theme system, keymap persistence, Vim mode, reverse history search, queued follow-ups, accessible no-color mode, and screen-reader-friendly direct mode |
| Done     | Memory                     | Explicit opt-in project memory has provenance, secret redaction, review/delete controls, and excludes external context by default                                                                   | Add user scope only after a clear precedence and privacy design exists                                                                                  |
| P2       | Remote runtime             | Local process only                                                                                                                                                                                  | Authenticated local/remote app server protocol with reconnectable TUI and IDE clients                                                                   |
| P2       | Cloud/offload              | Not supported                                                                                                                                                                                       | Provider-neutral remote task interface with best-of-N attempts and local patch application                                                              |
| P2       | Workflow recording         | Not supported                                                                                                                                                                                       | Record/replay for terminal and tool workflows, compiled into reviewable skills                                                                          |
| P2       | Enterprise governance      | Basic local permissions                                                                                                                                                                             | Managed policy, signed plugin trust, allowed provider/model lists, audit export, retention controls, and policy precedence                              |

## Architecture changes required

### 1. Split the CLI runtime

`packages/cli/src/commands/run.ts` is now a thin entry point. The first runtime
split is also complete:

- `runtime/CommandRouter.ts` delegates shell, config, context, rollback, and
  session domains to tested handlers under `runtime/commands/`.
- `tui/FullscreenTui.ts` delegates prompt state/rendering, input history,
  terminal text, paging, input helpers, and theme constants to focused modules;
  terminal I/O now starts through an explicit lifecycle method.
- `runtime/webui/` separates its process facade, per-instance server, SSE
  bridge, security, serialization, HTTP boundary, browser fragments, and CSS
  fragments. Stopped instances cannot publish into replacement runtimes.

The conversation turn grouping and environment/status telemetry are now owned
by tested `TuiConversationViewModel.ts` and `TuiEnvironmentStatus.ts` modules.
`FullscreenTui.ts` remains the composition and rendering owner so this split did
not change the established terminal layout.

Target modules:

- `runtime/ReplController.ts`
- `runtime/commands/*.ts`
- `runtime/TaskExecutor.ts`
- `runtime/ProviderFactory.ts`
- `tui/TuiPromptSession.ts` and `tui/TuiPromptView.ts`
- `commands/builtin/*.ts`
- `commands/custom/CustomCommandRegistry.ts`
- `security/InteractiveApproval.ts`
- `automation/JsonlReporter.ts`

No major feature should expand these hotspot files without first extracting a
focused handler, coordinator, or view module with colocated tests.

### 2. Typed event protocol (implemented baseline)

`EventBus` payloads use a discriminated Zod envelope shared by the TUI, Web UI,
JSONL automation, and trace surfaces. The v1 golden fixture protects serialized
compatibility. New event families must extend that schema and add a migration or
versioned fixture when the wire representation changes.

Required event families:

- session lifecycle
- model request and usage
- reasoning and response deltas
- tool proposal, approval, execution, and result
- file diff and checkpoint
- verification start/result
- agent spawn/status/result
- context assembly and compaction
- warning/error/final result

### 3. Explicit provider capabilities (implemented baseline)

Providers declare and routing consumes support for:

- streaming
- native tools
- reasoning
- prompt caching
- images
- embeddings
- structured output
- maximum context/output

Known profiles provide the authoritative capability record. Unknown compatible
models use conservative defaults rather than optimistic name guessing; live
capability negotiation remains a future enhancement.

### 4. Shared safety path (implemented baseline, keep extending)

Model tools, direct commands, Git, hooks, MCP tools, and orchestrated agents now
pass through the shared permission/audit path. Future extension loaders and new
execution surfaces must do the same:

- model tool calls
- direct shell commands
- Git commands
- hooks
- MCP tools
- custom commands that request execution
- subagents
- plugins

Permission decisions should include normalized target scope, command classification, source agent/thread, policy layer, and an auditable reason.

## Delivery sequence

### Phase A: automation and trust

1. `orbit exec --jsonl` — complete
2. typed event protocol — complete baseline
3. verification contracts — complete baseline
4. trace export and replay fixtures — complete baseline
5. worktree isolation — complete baseline

### Phase B: agent leverage

1. parallel agent-thread manager
2. custom agent manifests
3. dedicated review engine
4. task DAG and dependency-aware scheduling
5. per-agent model, budget, tool, and sandbox configuration

### Phase C: ecosystem

1. hooks v2
2. plugin manifest and installer
3. complete MCP transports and auth
4. skills with progressive loading
5. signed/team-managed extension policy

### Phase D: experience

1. image input
2. theme/keymap/Vim/history search
3. remote TUI protocol
4. opt-in durable memory
5. workflow record/replay

## Competitive acceptance suite

Orbit should extend the existing `orbit bench` provider latency/cache microbenchmark into a public competitive acceptance harness instead of relying on subjective comparisons.

Minimum scenarios:

- repository orientation and architecture explanation
- multi-file feature implementation
- failing-test diagnosis and repair
- security review with exploitable finding detection
- dependency/API migration
- merge-conflict resolution
- long-session context retention
- interrupted task resume
- unsafe command rejection
- rollback after partial failure
- parallel review across six independent concerns
- non-interactive CI execution
- custom workflow reuse
- MCP tool failure and reconnect
- Windows, macOS, and Linux terminal compatibility

Track:

- completion rate
- verified correctness
- median wall-clock time
- model input/output/cache tokens
- user approval count
- unintended file changes
- rollback success
- context-retrieval precision
- crash/hang rate

## Source baseline

- Codex CLI features and customization: <https://developers.openai.com/codex/cli/features>
- Codex subagents: <https://developers.openai.com/codex/subagents>
- Codex hooks: <https://developers.openai.com/codex/hooks>
- Claude Code documentation: <https://docs.anthropic.com/en/docs/claude-code/overview>
- Gemini CLI repository: <https://github.com/google-gemini/gemini-cli>
- Aider repository: <https://github.com/Aider-AI/aider>
- OpenCode repository: <https://github.com/sst/opencode>
- Goose repository: <https://github.com/block/goose>
- Qwen Code repository: <https://github.com/QwenLM/qwen-code>
