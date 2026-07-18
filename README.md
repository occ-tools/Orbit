# Orbit

> A local-first AI coding agent for the terminal, browser, and editor—optimized
> for DeepSeek V4 while remaining compatible with OpenAI-style providers and
> local Ollama models.

[![npm](https://img.shields.io/npm/v/@orbit-build/cli?label=npm)](https://www.npmjs.com/package/@orbit-build/cli)
[![CI](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml/badge.svg)](https://github.com/Hephaestus-DevKit/Orbit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-43853d)](https://nodejs.org/)

Orbit works inside a project instead of treating every prompt as an isolated
chat. It can inspect and edit files, search symbols and references, run commands
and tests, verify changes, preserve project-scoped conversations, and recover
from checkpoints. The full-screen TUI and authenticated local Web UI use the
same agent runtime, active model, chat history, approvals, and cancellation
state.

## Install

Requirements: Node.js 20 or newer, plus either a supported provider API key or
a running local [Ollama](https://ollama.com/) instance.

```bash
npm install --global @orbit-build/cli
orbit --version
orbit login
```

`orbit` is available in PowerShell, Command Prompt, and POSIX shells after the
npm global binary directory is on `PATH`. Open a new terminal if a shell that
was already running does not find the command.

## Start working

Run Orbit from a codebase:

```bash
cd path/to/project
orbit
```

Or execute one task directly:

```bash
orbit "Find the cause of the failing build, fix it, and run the tests"
orbit "Review the authentication flow" --yes
```

Inside the TUI, enter `/webui` to open the browser workspace. The terminal must
remain open because it owns the local agent process:

```text
/webui
/webui 8080
/webui --no-open
```

The Web UI groups work by project folder. Each project can contain multiple
persisted chats; chats can be resumed, archived, or deleted without mixing
their history with another project. The native folder picker is used when the
platform supports it, with a validated path field as the fallback.

## What Orbit includes

- **One runtime across TUI and Web UI.** Model changes, turns, streamed output,
  approvals, cancellation, chat titles, and context telemetry stay synchronized.
- **DeepSeek V4-first routing.** Flash handles latency-sensitive work; Pro handles
  planning, coding, review, and repair with explicit thinking modes.
- **Project-aware context.** AST symbols, references, PageRank repository maps,
  BM25/vector retrieval, selected files, project instructions, and explicit
  project memory feed a bounded context pack.
- **Model-aware continuity.** Switching provider or model keeps the conversation;
  Orbit recalculates the new context window and compacts older history when
  required instead of silently dropping the chat.
- **Safe edits and verification.** Workspace path checks, permission decisions,
  reviewable diffs, Git checkpoints, rollback, test/lint/build contracts, and
  bounded failure summaries protect the working tree.
- **Local diagnostics.** Provider probes, DeepSeek cache telemetry, benchmarks,
  session metrics, traces, and a credential-safe JSON support snapshot make
  failures diagnosable.
- **Editor integration.** `orbit lsp` exposes local JSON-RPC autocomplete, and a
  VS Code client is included under `editors/vscode`.

## Providers and models

Run `orbit login` to create, inspect, and delete saved provider profiles. Orbit
stores credentials through its credential manager and redacts secrets from
configuration output, diagnostics, events, and sessions.

For an OpenAI-compatible service, enter the exact base URL required by that
service—for example `https://provider.example/v1`. Orbit does not guess or append
API suffixes. After authentication, it can query the provider's model endpoint
and populate the model selector from the returned catalog.

For local Ollama, Orbit queries the local Ollama API and lists the models that
are actually installed. If Ollama is unavailable, the provider remains usable
after the service starts instead of fabricating a model list.

Useful checks:

```bash
orbit config
orbit doctor
orbit doctor --deepseek
orbit doctor --probe --deepseek
orbit doctor --json
orbit doctor --strict
```

`doctor --json` produces a versioned, secret-safe support snapshot and redacts
the workspace path by default. `--strict` returns a non-zero exit status when
warnings or errors are present.

## DeepSeek V4 profile

Orbit's default official provider is the OpenAI-compatible DeepSeek endpoint at
`https://api.deepseek.com`. The optional Anthropic-compatible provider uses
`https://api.deepseek.com/anthropic`.

| Model               | Default roles             | Thinking |   Context | Provider max output | Orbit request default |
| ------------------- | ------------------------- | -------- | --------: | ------------------: | --------------------: |
| `deepseek-v4-flash` | default, fast, summarizer | disabled | 1,000,000 |             384,000 |                 8,192 |
| `deepseek-v4-pro`   | planner, coder, reviewer  | high     | 1,000,000 |             384,000 |                16,384 |

Both lanes support thinking/non-thinking modes, streaming, JSON output, and
native tool calls. Orbit's smaller request defaults are latency and cost
safeguards; they do not represent the provider capability limit.

### Context cache behavior

DeepSeek caching is automatic and best-effort. Orbit keeps reusable system,
tool, and project prefixes stable, moves volatile repository context later in
the request, and reads real `prompt_cache_hit_tokens` and
`prompt_cache_miss_tokens` usage. It does not send synthetic cache primers,
background pings, or claim a fixed hit rate.

```bash
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
orbit bench --model deepseek-v4-flash --thinking disabled --cache-profile --repeat 3 --min-cache-hit 75
```

Legacy aliases retain their historical thinking behavior while migrating to V4:

- `deepseek-chat` → `deepseek-v4-flash`, thinking disabled
- `deepseek-reasoner` → `deepseek-v4-flash`, thinking high

New configuration should use the V4 IDs directly. Provider behavior is
documented in DeepSeek's [V4 release notes](https://api-docs.deepseek.com/news/news260424/),
[thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/), and
[context-cache guide](https://api-docs.deepseek.com/guides/kv_cache/).

## Persistent project workflows

Orbit makes long-running work explicit and recoverable:

```text
/goal <objective>       Set the durable objective for this chat
/plan add <step>        Add a recoverable plan step
/plan start|done <n>    Update a step by its displayed number
/memory add <text>      Save an explicit project preference
/memory list            Review project memory
/memory remove <n>      Delete one entry; clear/on/off are also available
/compact                Compact history against the active model window
/metrics                Show local routing, tool, file, and compaction metrics
/model                  Select a provider/model or return to automatic routing
/timeline               List persisted file checkpoints
/rewind <id|n>          Restore a selected checkpoint
/rollback               Restore the latest checkpoint
```

Project memory is opt-in and secret-redacted. Orbit never turns chat or web
content into durable memory automatically. Goals, plans, history, and active
model metadata are stored with the chat so switching chats does not merge
unrelated work.

Create reusable slash commands as Markdown:

- Project commands: `.orbit/commands/*.md`
- User commands: `~/.orbit/commands/*.md`

Example `.orbit/commands/review.md`:

```markdown
---
description: Review a target for correctness, security, and missing tests
argumentHint: <path-or-scope>
---

Review $ARGUMENTS. Prioritize concrete bugs, security issues, regressions, and
missing verification.
```

Run it with `/review packages/core`. Templates support `$ARGUMENTS`, `{{args}}`,
and `$1` through `$9`. Project commands override user commands; built-ins cannot
be shadowed.

## Non-interactive automation

Use `orbit exec` for CI or scripts:

```bash
orbit exec "Run the verification contract and fix the failure" --jsonl
```

JSONL mode never opens approval menus. Policy-approved actions continue and
actions that still require interactive approval fail safely. Stable exit codes:

|  Code | Meaning                      |
| ----: | ---------------------------- |
|   `0` | completed                    |
|   `2` | task or verification failure |
|   `4` | provider startup failure     |
| `130` | aborted                      |

## Editor integration

Start the built-in Language Server Protocol process with:

```bash
orbit lsp
```

The VS Code client lives in [`editors/vscode`](editors/vscode). Other editors can
spawn `orbit lsp` over stdin/stdout and use `orbit.config.yaml` or `.git` as the
workspace root marker.

## Repository structure

Orbit is a pnpm monorepo with strict package ownership:

| Package                                       | Responsibility                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| [`cli`](packages/cli)                         | command entry points, runtime assembly, TUI, Web UI, LSP, diagnostics    |
| [`core`](packages/core)                       | agent lifecycle, planning, message/context coordination, cache telemetry |
| [`model-providers`](packages/model-providers) | DeepSeek, OpenAI, Anthropic, and Ollama protocol adapters                |
| [`context-engine`](packages/context-engine)   | indexing, symbol/reference retrieval, repo maps, context packing         |
| [`tools`](packages/tools)                     | file, search, shell, Git, project, and web tools                         |
| [`permissions`](packages/permissions)         | risk classification and approval policy                                  |
| [`sandbox`](packages/sandbox)                 | checkpoints, rollback, worktrees, isolated execution                     |
| [`session`](packages/session)                 | chat persistence, plans, metrics, audit serialization                    |
| [`config`](packages/config)                   | Zod configuration, defaults, profile loading, credential storage         |
| [`tui`](packages/tui)                         | reusable terminal rendering and prompt components                        |
| [`mcp`](packages/mcp)                         | MCP connection and dynamic tool discovery                                |
| [`shared`](packages/shared)                   | path, token, redaction, error, and other dependency-light primitives     |

Start with the [documentation index](docs/README.md) and
[maintainer guide](docs/MAINTAINER_GUIDE.md). Detailed maps live next to the
[agent runtime](packages/core/src/agent/README.md),
[CLI runtime commands](packages/cli/src/runtime/commands/README.md),
[full-screen TUI](packages/cli/src/tui/README.md), and
[Web UI runtime](packages/cli/src/runtime/webui/README.md).

## Develop from source

```bash
git clone https://github.com/Hephaestus-DevKit/Orbit.git
cd Orbit
pnpm install
pnpm build
pnpm install-global
```

Run the complete verification contract before committing:

```bash
pnpm verify
```

Release candidates must also validate the built executable, npm package
contents, production dependency audit, and smoke tests:

```bash
pnpm verify:release
```

CI verifies supported Node.js versions and Windows/macOS behavior. See
[`SECURITY.md`](SECURITY.md) for private vulnerability reporting,
[`CHANGELOG.md`](CHANGELOG.md) for user-facing changes, and the
[commercial release checklist](docs/COMMERCIAL_RELEASE_CHECKLIST.md) for owner
decisions that cannot be automated.

## License

License terms have not yet been finalized. Do not infer permission to use,
modify, or redistribute the source from repository visibility alone. A license
must be selected before commercial distribution.
