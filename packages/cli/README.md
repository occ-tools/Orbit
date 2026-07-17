# @orbit-build/cli

Orbit is a local-first AI coding agent for the terminal and editor. The CLI opens an interactive TUI, runs one-shot tasks, exposes an LSP autocomplete server, and includes provider diagnostics and repeatable latency/cache benchmarks.

## Requirements

- Node.js 20 or newer
- A supported model provider API key, or a local Ollama installation

## Install and open Orbit

From the Orbit workspace:

```bash
pnpm install
pnpm build
pnpm install-global
```

The global command works in Command Prompt and PowerShell:

```bash
orbit login
orbit
```

Enter `/webui` inside the interactive prompt to open the local browser UI.

## Development map

- Runtime slash commands: [`src/runtime/commands/README.md`](src/runtime/commands/README.md)
- Full-screen terminal UI: [`src/tui/README.md`](src/tui/README.md)
- Loopback browser UI: [`src/runtime/webui/README.md`](src/runtime/webui/README.md)
- Repository maintenance guide: [`../../docs/MAINTAINER_GUIDE.md`](../../docs/MAINTAINER_GUIDE.md)

Run `pnpm test:cli` for CLI tests or `pnpm verify:cli` for lint, formatting,
tests, and the CLI ESM/type build.

## DeepSeek V4 defaults

The default provider is `deepseek-openai` at `https://api.deepseek.com`.

| Model               | Default roles             | Thinking default |   Context | Provider max output | Orbit request default |
| ------------------- | ------------------------- | ---------------- | --------: | ------------------: | --------------------: |
| `deepseek-v4-flash` | default, fast, summarizer | disabled         | 1,000,000 |             384,000 |                 8,192 |
| `deepseek-v4-pro`   | planner, coder, reviewer  | high             | 1,000,000 |             384,000 |                16,384 |

Both models support thinking/non-thinking modes, native tools, JSON output, and streaming. DeepSeek context caching is automatic and best-effort. Orbit keeps reusable prefixes stable, reports real hit/miss token telemetry, and does not send synthetic primer or keepalive requests.

The temporary aliases preserve their historical mode while moving to V4:

- `deepseek-chat` → `deepseek-v4-flash`, thinking disabled
- `deepseek-reasoner` → `deepseek-v4-flash`, thinking high

DeepSeek announced that both aliases will become inaccessible after 2026-07-24 15:59 UTC, so new configuration should use the V4 IDs.

## Diagnostics and benchmarks

```bash
orbit doctor --deepseek
orbit doctor --probe --deepseek
orbit doctor --json
orbit doctor --strict

orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
orbit bench --model deepseek-v4-flash --thinking disabled --cache-profile --repeat 3 --min-cache-hit 75
```

`--repeat` accepts 1–20 samples. `--max-tokens` accepts 1–16,384; defaults are 256 with thinking disabled, 4,096 for high, and 8,192 for max. A cache profile runs at least three samples and defaults to disabled thinking unless explicitly overridden.

`doctor --json` emits a versioned, credential-safe support snapshot and redacts
the workspace path by default. Add `--strict` in automation to return a non-zero
status when the snapshot contains warnings or errors.

See the official DeepSeek [V4 release notes](https://api-docs.deepseek.com/news/news260424/), [thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/), and [context-cache guide](https://api-docs.deepseek.com/guides/kv_cache/).

## Other commands

```text
orbit [task]      Open the TUI or execute a task
orbit config      Show resolved, redacted configuration
orbit init        Create project ORBIT.md instructions
orbit lsp         Start the local autocomplete language server
orbit exec        Run a non-interactive task with optional JSONL events
```

For automation, use `orbit exec "task" --jsonl`. It never opens terminal
approval menus: policy-approved changes continue, while actions that still
require approval are denied safely. The final `agent_completed` event contains
the structured outcome. Exit codes are stable: `0` completed, `2` task or
verification failure, `4` provider startup failure, and `130` aborted.

Run `orbit --help` or `orbit <command> --help` for all options.
