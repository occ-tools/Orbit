# 🪐 Orbit

> **Orbit** is a production-grade, local-first AI coding agent runtime and Language Server for terminals and editors. It is optimized for **DeepSeek V4 Flash/Pro**, with explicit thinking-mode routing, automatic stable-prefix cache reuse, native tool calls, and streaming output on Windows, macOS, and Linux.

---

## ✨ Features

- **🚀 DeepSeek V4-First & Automatic Prefix Caching**:
  Keeps reusable system, tool, and project prefixes stable so DeepSeek can reuse its automatic context cache at persisted request boundaries. Orbit measures real cache hit/miss tokens and does not send synthetic primer or keepalive requests.
- **🔍 References-Aware Cross-File RAG**:
  Locates AST symbols across the repository and retrieves their calling sites (including 3 lines of context above and below), providing reasoning models with accurate structural usage examples during refactorings.
- **🗺️ Graded PageRank Landmark Maps**:
  Constructs token-efficient project repository maps using PageRank weights computed from AST imports/exports. Automatically grades output detail levels (`detailed` -> `outline` -> `simple`) to maximize codebase resolution within your LLM token budget.
- **⚡ Real-Time LSP Autocomplete Server**:
  Features a built-in JSON-RPC LSP Server (`orbit lsp`) with connection caching and tab-specific `AbortController` debouncing. Automatically cancels obsolete completions during high-frequency typing on a per-tab basis.
- **🔒 Sandboxed Subprocess Timeouts**:
  Enforces configurable hard timeouts for shell executions and test runs (120 seconds by default), executing subprocesses in isolated process groups to clean up orphans immediately upon timeouts or user interrupts.
- **💾 Auto-Healing Vector Indexing & Atomic Writes**:
  Dynamically adapts to changes in embedding models or dimensions, automatically clearing and reindexing the database. Official DeepSeek chat endpoints fall back immediately to lexical BM25 unless a separate embedding-capable provider is configured. All vector store and symbols indexes are written atomically (`.tmp` -> rename) to avoid race conditions.
- **🛡️ Sandbox & Permissions Manager**:
  Protects sensitive files (e.g., `.env`, credentials), intercepts bash executions for user approvals, and maintains git checkpoints for automatic rollbacks when modifications are rejected.

---

## 📦 Monorepo Packages

Orbit is organized as a clean, modular pnpm monorepo:

- [`@orbit-build/cli`](packages/cli): Main CLI commander entry point and LSP server bridge.
- [`@orbit-build/core`](packages/core): Core agent loop, prompt caching, state managers, and autocomplete debouncer.
- [`@orbit-build/context-engine`](packages/context-engine): AST Symbol Indexer, PageRank Repo Map generator, and hybrid BM25/Vector RAG.
- [`@orbit-build/model-providers`](packages/model-providers): Providers for DeepSeek, OpenAI, Anthropic, and local Ollama streams.
- [`@orbit-build/sandbox`](packages/sandbox): Git checkpoint managers and command execution rollback controllers.
- [`@orbit-build/tools`](packages/tools): File system operations, grep scanner, reference searchers, and shell execution sandboxes.
- [`@orbit-build/tui`](packages/tui): Terminal UI interactive prompt controls and colored terminal renderers.
- [`@orbit-build/shared`](packages/shared): Common path utilities, token metrics, and shared schemas.

For code ownership, common change locations, safety invariants, and focused
verification commands, start with the [maintainer guide](docs/MAINTAINER_GUIDE.md).
Web UI changes also have a colocated
[runtime map](packages/cli/src/runtime/webui/README.md).

---

## 🚀 Quick Start

### 1. Installation

Build the workspace packages and link the CLI executable globally:

```bash
# Install dependencies and build monorepo packages
pnpm install
pnpm build

# Link the CLI package globally (enables `orbit` command in CMD and PowerShell)
pnpm install-global
```

Verify that the global binary is active:

```bash
orbit --help
orbit --version
```

The linked `orbit` command works from both Command Prompt and PowerShell. If an already-open terminal cannot find it, open a new terminal after linking.

### 2. Configuration & Diagnostics

Configure your API keys interactively and securely (keys are encrypted on disk using native system DPAPI or fallback AES-GCM):

```bash
orbit login
```

Run environment diagnostics, inspect DeepSeek V4 alignment, and optionally make a lightweight live provider request:

```bash
orbit doctor
orbit doctor --deepseek
orbit doctor --probe --deepseek
orbit doctor --json
orbit doctor --strict
```

Inspect resolved configuration values, model assignments, and pricing sheets:

```bash
orbit config
```

### 3. Usage

Open Orbit's interactive TUI in the current folder, or execute a task directly:

```bash
# Open the interactive TUI
orbit

# Execute a task
orbit "Add unit tests for references retriever"

# Bypass low-risk approval prompts automatically
orbit "Refactor VectorStore load" --yes
```

### Web UI

Start Orbit in the project you want to work on, then enter `/webui` in the
interactive prompt:

```text
orbit
/webui
```

Orbit opens the local Web UI in the default browser. Use `/webui 8080` to
select a port, or `/webui --no-open` to print the local address without opening
a browser. The access token is moved from the launch URL into an HttpOnly,
same-site cookie during bootstrap and is not printed in terminal event logs.

---

## 🧠 DeepSeek V4 Profile

Orbit's default provider is the official OpenAI-compatible DeepSeek endpoint at `https://api.deepseek.com`. The optional `deepseek-anthropic` provider uses `https://api.deepseek.com/anthropic`.

| Model               | Default Orbit roles       | Orbit thinking default |   Context | Provider max output | Orbit request default |
| ------------------- | ------------------------- | ---------------------- | --------: | ------------------: | --------------------: |
| `deepseek-v4-flash` | default, fast, summarizer | disabled               | 1,000,000 |             384,000 |                 8,192 |
| `deepseek-v4-pro`   | planner, coder, reviewer  | high                   | 1,000,000 |             384,000 |                16,384 |

Both V4 lanes support thinking and non-thinking modes, native tool calls, JSON output, and streaming. Orbit explicitly disables thinking for its latency-sensitive Flash path and enables high effort for Pro planning, coding, review, and repair work. The smaller Orbit request defaults are latency/cost safeguards, not provider capability limits; they can be adjusted through `agent.fastMaxOutputTokens` and `agent.maxOutputTokens`.

### Automatic context cache

DeepSeek's context cache is automatic and best-effort. Orbit improves reuse by keeping the reusable prompt prefix and completed conversation boundaries stable while placing changing repository context later in the request. It reads `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` from API usage rather than assuming that a request is warm.

Orbit does not send background cache pings, does not assume a fixed cache TTL, and does not promise a fixed latency reduction. The official DeepSeek Anthropic-compatible endpoint also ignores Anthropic `cache_control`; no manual cache marker is required.

Inspect real local telemetry with:

```bash
orbit doctor --deepseek
orbit bench --model deepseek-v4-flash --thinking disabled --cache-profile --repeat 3 --min-cache-hit 75
```

### Latency and quality benchmarks

Benchmark Flash and Pro separately so thinking latency, first-answer latency, decode throughput, and cache telemetry remain comparable:

```bash
# Low-latency, non-thinking Flash path
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256

# Higher-quality Pro reasoning path
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096

# Maximum Pro reasoning effort
orbit bench --model deepseek-v4-pro --thinking max --repeat 3 --max-tokens 8192

# Optional release gate; tune these budgets against a controlled runner and account
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 5 --max-first-delta-ms 2500 --max-first-text-ms 5000 --min-throughput 20 --max-error-rate 0
```

Benchmark samples accept `--repeat` values from 1 to 20. `--max-tokens` accepts 1 to 16,384; mode-aware defaults are 256 for disabled thinking, 4,096 for high, and 8,192 for max. Cache profiles run at least three samples and default to disabled thinking unless `--thinking` is supplied. Optional gates evaluate p90 first-model-delta latency, p90 first-answer latency, p50 decode throughput, and the sample error ratio. Omit them during exploratory runs; approve environment-specific budgets before using them as release blockers.

### Legacy alias migration

DeepSeek announced that `deepseek-chat` and `deepseek-reasoner` will become inaccessible after **2026-07-24 15:59 UTC**. Orbit preserves their behavior while migrating requests to V4:

- `deepseek-chat` → `deepseek-v4-flash` with thinking disabled
- `deepseek-reasoner` → `deepseek-v4-flash` with thinking high

Use the V4 model IDs in new configuration. See the official [V4 release notes](https://api-docs.deepseek.com/news/news260424/), [thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/), and [context-cache guide](https://api-docs.deepseek.com/guides/kv_cache/) for provider behavior.

---

## 🔌 Editor LSP Autocomplete Setup

Orbit exposes a standard Language Server Protocol (LSP) interface on `orbit lsp`.

### VS Code

Compile and load the VS Code extension located under [editors/vscode](editors/vscode) into your VS Code editor. It will automatically spawn `orbit lsp` on startup and query it for real-time code completions.

### Neovim / Helix / Emacs

Configure your editor's LSP client to spawn `orbit lsp` as a completion language server. The server expects JSON-RPC input on `stdin` and writes JSON-RPC outputs to `stdout`.

## ⌨️ Custom Slash Commands

### Built-in continuity controls

Orbit keeps long-running project work explicit and reviewable:

```text
/goal <objective>       Set the durable objective for the current chat
/plan add <step>        Add a recoverable chat-specific plan step
/plan start|done <n>    Update a step by its displayed number
/memory add <text>      Save an explicit, secret-redacted project preference
/memory list            Review project memory before it reaches the model
/memory remove <n>      Delete one memory entry; use clear/on/off as needed
/metrics                Show local tool, routing, file, and compaction metrics
/model auto             Let Orbit route DeepSeek V4 Flash/Pro by task
```

Project memory is opt-in: Orbit never converts conversation or external web
content into durable memory automatically. Plans live with their chat session,
so switching projects or chats does not mix unrelated work.

### Custom commands

Create reusable prompt workflows as Markdown files:

- Project commands: `.orbit/commands/*.md`
- User commands: `~/.orbit/commands/*.md`

Example `.orbit/commands/review.md`:

```markdown
---
description: Review a target for correctness, security, and missing tests
argumentHint: <path-or-scope>
---

Review $ARGUMENTS. Prioritize concrete bugs, security issues, regressions, and missing verification.
```

Run it with:

```bash
/review packages/core
```

Templates support `$ARGUMENTS`, `{{args}}`, and positional placeholders `$1` through `$9`. Project commands override user commands, while built-in Orbit commands cannot be shadowed.

## ↩️ Persistent Time Travel

Orbit persists file checkpoints under `.orbit/checkpoints/` so recovery survives process restarts:

```text
/timeline        List available checkpoints
/rewind          Select a checkpoint interactively
/rewind <id|n>   Rewind to a checkpoint by ID or timeline index
/rollback        Roll back the latest checkpoint
```

Rewinding applies checkpoints newest-first and consumes restored checkpoints, keeping the timeline consistent.

## 🖱️ Mouse Scrollback

The fullscreen TUI supports mouse-wheel and trackpad scrolling through chat history. It keeps the current viewport stable while new model output arrives and shows a new-output indicator until you return to the bottom.

Keyboard alternatives:

- `PageUp` / `PageDown`: scroll by page
- `Ctrl+Home`: jump to the oldest available history
- `End`: return to live output

Configure mouse behavior in `orbit.config.yaml` or `~/.orbit/config.yaml`:

```yaml
schemaVersion: 1
tui:
  mouse: true
  scrollSpeed: 50 # 1-100
```

Example configuration snippet for Neovim (`nvim-lspconfig` compatible):

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.orbit_lsp then
  configs.orbit_lsp = {
    default_config = {
      cmd = { 'orbit', 'lsp' },
      filetypes = { 'typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'python' },
      root_dir = lspconfig.util.root_pattern('orbit.config.yaml', '.git'),
      settings = {},
    },
  }
end

lspconfig.orbit_lsp.setup({})
```

---

## 🧪 Verification & Testing

Run the complete verification contract before submitting changes. It checks linting, formatting, builds, and the full test suite:

```bash
pnpm verify
```

Release candidates additionally run a production dependency audit, verify the
exact npm package contents, and smoke-test the built executable:

```bash
pnpm verify:release
```

GitHub Actions runs the full verification contract on Node.js 20, 22, and 24,
plus Windows and macOS platform jobs. See `SECURITY.md` for private vulnerability
reporting, `CHANGELOG.md` for user-facing changes, and the
[commercial release checklist](docs/COMMERCIAL_RELEASE_CHECKLIST.md) for the
manual and owner-approved gates required before distribution.

---

## 🛡️ License

License terms have not yet been finalized in this repository. They must be
selected before public commercial distribution; do not infer a license from
source availability alone.
