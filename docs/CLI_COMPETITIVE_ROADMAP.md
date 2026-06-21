# Orbit CLI Competitive Roadmap

Last reviewed: 2026-06-21

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
- DeepSeek-oriented prompt-cache keepalive and cache-cost visibility.
- Hybrid repository context with symbols, PageRank landmarks, BM25/vector retrieval, and reference expansion.
- Workspace path-boundary utilities and protected-path policy.
- Read-only context references enforced during tool execution.
- Persistent sessions, command history, context controls, and session forking.
- Interactive steering while an agent is running.
- Persistent file checkpoints with `/timeline`, `/rewind`, and `/rollback`.
- Project and user custom prompt commands under `.orbit/commands/` and `~/.orbit/commands/`.
- Permission-aware direct shell and Git commands.
- Chinese and English terminal UI.

## Highest-priority gaps

| Priority | Capability | Current state | Required outcome |
| --- | --- | --- | --- |
| P0 | Parallel subagents | Fixed planner/coder/reviewer sequence | Agent-thread manager with parallel fan-out, role manifests, per-agent budgets, cancellation, result consolidation, and visible approval ownership |
| P0 | Non-interactive automation | One-shot prompt exists, but output is human-oriented | `orbit exec` with JSONL events, stable schemas, deterministic exit codes, resume support, output-schema validation, and CI-safe approval failure behavior |
| P0 | Verification contracts | Tests can run, but success policy is distributed | First-class task acceptance contract covering build, tests, lint, typecheck, security checks, changed-file limits, and required artifacts |
| P0 | Full audit trail | Session events exist but are not a supported interface | Exportable trace containing prompts, model routing, tool calls, approvals, diffs, checkpoints, verification, timing, and cost with secret redaction |
| P0 | Agent isolation | Agents share one working tree | Optional Git worktree per agent/task, conflict-aware merge, and cleanup policy |
| P1 | Hook system | Only pre-edit and post-edit command hooks | Typed lifecycle hooks for session, prompt, permission, pre/post tool, compact, verification, subagent, and stop events |
| P1 | Plugin and skill system | Custom prompt commands and MCP exist separately | Versioned plugin manifest bundling commands, skills, agents, hooks, MCP servers, tools, templates, and compatibility metadata |
| P1 | MCP completeness | STDIO tool discovery is supported | Streaming HTTP transport, OAuth, resources, prompts, reconnect policy, health state, tool-name collision handling, and per-server permissions |
| P1 | Code review product | Reviewer role exists only in orchestration | Dedicated `/review` presets for uncommitted work, commits, branches, security, tests, accessibility, and custom policy |
| P1 | Multimodal input | Text-only primary workflow | Image attachment, clipboard paste, screenshot context, image-aware provider capability negotiation, and transcript persistence |
| P1 | TUI power-user controls | Strong custom TUI, limited customization | Theme system, keymap persistence, Vim mode, reverse history search, queued follow-ups, accessible no-color mode, and screen-reader-friendly direct mode |
| P1 | Memory | AGENTS and session history are available | Explicit opt-in durable memory with provenance, secret redaction, project/user scopes, review UI, and external-context exclusion |
| P2 | Remote runtime | Local process only | Authenticated local/remote app server protocol with reconnectable TUI and IDE clients |
| P2 | Cloud/offload | Not supported | Provider-neutral remote task interface with best-of-N attempts and local patch application |
| P2 | Workflow recording | Not supported | Record/replay for terminal and tool workflows, compiled into reviewable skills |
| P2 | Enterprise governance | Basic local permissions | Managed policy, signed plugin trust, allowed provider/model lists, audit export, retention controls, and policy precedence |

## Architecture changes required

### 1. Split the CLI runtime

`packages/cli/src/commands/run.ts` is over 7,000 lines and currently owns rendering, input, commands, sessions, shell execution, provider setup, configuration, and workflow behavior.

Target modules:

- `runtime/ReplController.ts`
- `runtime/CommandRouter.ts`
- `runtime/TaskExecutor.ts`
- `runtime/ProviderFactory.ts`
- `tui/FullscreenTui.ts`
- `commands/builtin/*.ts`
- `commands/custom/CustomCommandRegistry.ts`
- `security/InteractiveApproval.ts`
- `automation/JsonlReporter.ts`

No major feature should continue expanding `run.ts`.

### 2. Introduce a typed event protocol

Replace the untyped `EventBus` payloads with a discriminated Zod event schema. Every UI, JSONL automation client, trace exporter, remote client, and test harness should consume the same protocol.

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

### 3. Make capabilities explicit

Each provider should declare support for:

- streaming
- native tools
- reasoning
- prompt caching
- images
- embeddings
- structured output
- maximum context/output

Routing must use capabilities rather than model-name substring heuristics.

### 4. Make safety consistent

All execution paths must pass through the same permission engine:

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

1. `orbit exec --jsonl`
2. typed event protocol
3. verification contracts
4. trace export and replay fixtures
5. worktree isolation

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

Orbit should maintain a public benchmark harness instead of relying on subjective comparisons.

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
