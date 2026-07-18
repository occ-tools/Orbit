# @orbit-build/cli

Orbit is a local-first AI coding agent for the terminal, browser, and editor. It
is optimized for DeepSeek V4, supports compatible hosted providers and local
Ollama models, and keeps project chats, active model state, approvals, and
context synchronized between its TUI and Web UI.

## Install

Requires Node.js 20 or newer.

```bash
npm install --global @orbit-build/cli
orbit --version
orbit login
```

Run `orbit` from a project folder:

```bash
cd path/to/project
orbit
```

The global command works in PowerShell, Command Prompt, and POSIX shells. Open a
new terminal if an existing shell has not refreshed npm's global binary path.

## Main workflows

```bash
orbit                         # interactive full-screen TUI
orbit "Fix the failing tests" # one-shot task
orbit exec "Review src" --jsonl
orbit doctor --deepseek
orbit config
orbit update --check
orbit lsp
```

Inspect or remove Orbit-owned runtime data with `orbit clean`. It never removes
project source, `ORBIT.md`, or `orbit.config.yaml`:

```bash
orbit clean --project
orbit clean --user
orbit clean --all
orbit clean --all --yes --json
```

Interactive cleanup requires the exact confirmation `DELETE`. Non-interactive
cleanup requires `--yes`; `--json` without `--yes` only returns the cleanup
preview. Uninstall the executable separately with
`npm uninstall --global @orbit-build/cli`.

Updates are explicit and use the installed npm runtime:

```bash
orbit update --check       # network check only
orbit update               # check, then confirm interactively
orbit update --yes         # explicit non-interactive install
orbit update --check --json
```

The TUI performs one bounded background version check per process: the cat heart
blinks when a newer release exists and stays steady otherwise. This check never
installs anything or blocks input, and Orbit never silently replaces itself.
The interactive `/update` command invokes this same Orbit CLI updater; it no
longer runs a package-manager install inside the active project. From the Web
UI it remains check-only to avoid interrupting the local server; the TUI can
confirm and install an available release.

Enter `/webui` inside the TUI to open Orbit's authenticated local browser UI.
Projects map to codebase folders and contain independent persisted chats that
can be resumed, archived, or deleted.

Use `/goal`, `/plan`, opt-in `/memory`, `/compact`, `/metrics`, `/model`,
`/timeline`, `/rewind`, and `/rollback` to manage durable work. Switching models
preserves the chat and recalculates context against the selected model window;
automatic compaction protects continuity when the new window is smaller.

## Providers

`orbit login` creates and deletes saved provider profiles. For an
OpenAI-compatible provider, supply its exact base URL, including `/v1` when the
service requires it; Orbit does not guess URL suffixes. Authenticated provider
catalogs and the local Ollama API populate the model selector with models that
are actually available.

The default official provider is DeepSeek's OpenAI-compatible endpoint at
`https://api.deepseek.com`:

| Model               | Default roles             | Thinking |   Context | Orbit output default |
| ------------------- | ------------------------- | -------- | --------: | -------------------: |
| `deepseek-v4-flash` | default, fast, summarizer | disabled | 1,000,000 |                8,192 |
| `deepseek-v4-pro`   | planner, coder, reviewer  | high     | 1,000,000 |               16,384 |

Orbit keeps reusable prefixes stable and reports measured DeepSeek cache
hit/miss usage. It does not send synthetic cache primers or promise a fixed hit
rate.

```bash
orbit doctor --probe --deepseek
orbit doctor --json --strict
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
```

## Automation contract

`orbit exec "task" --jsonl` never opens interactive approval menus. Approved
operations continue; operations that require user approval are denied safely.
The final event contains the structured outcome. Exit codes are `0` for
completion, `2` for task or verification failure, `4` for provider startup
failure, and `130` for abort.

## Documentation and development

- [Repository overview](https://github.com/Hephaestus-DevKit/Orbit#readme)
- [Maintainer guide](https://github.com/Hephaestus-DevKit/Orbit/blob/main/docs/MAINTAINER_GUIDE.md)
- [Security policy](https://github.com/Hephaestus-DevKit/Orbit/blob/main/SECURITY.md)
- [Changelog](https://github.com/Hephaestus-DevKit/Orbit/blob/main/CHANGELOG.md)

From a source checkout, run `pnpm install`, `pnpm build`, and
`pnpm install-global`. Use `pnpm verify:cli` for focused CLI verification or
`pnpm verify:release` before publishing.

License terms have not yet been finalized; repository visibility alone does not
grant permission to use, modify, or redistribute the source.
