# Orbit user guide

This guide is organized around tasks. Start with the first workflow, then use
the section links as needed; exhaustive option lists stay in `orbit --help`.

## First five minutes

Install Orbit with Node.js 20 or newer. The standard installers from
[nodejs.org](https://nodejs.org/) include npm on Windows, macOS, and Linux. If
neither command exists, install a current Node.js LTS release, open a new
terminal, and verify the runtime before installing Orbit:

```bash
node --version
npm --version
npm install --global @orbit-build/cli
orbit --version
orbit login
```

Open a codebase and start the interactive full-screen terminal:

```bash
cd path/to/project
orbit
```

Describe the outcome you want. Orbit can inspect the workspace, propose and
apply edits, run commands and tests, and report verification. Use `Ctrl+C` to
cancel an active operation; use it again from an idle prompt to exit cleanly.

Run `orbit doctor` if setup does not work. `orbit doctor --probe --deepseek`
adds a live provider probe, and `orbit doctor --json --strict` produces a
versioned, secret-safe support snapshot with a non-zero status for warnings or
errors.

## Projects, chats, and the Web UI

Orbit treats one folder as one project. Each project can contain multiple
persistent chats, and every chat retains its own history, active model, goal,
plan, metrics, and checkpoints.

- `/chat` lists, creates, switches, and deletes chats from the terminal.
- `/webui` opens the authenticated browser workspace for the current process.
- The Web UI sidebar creates, resumes, archives, restores, and deletes chats.
- Project selection uses a native folder picker when the platform supports it,
  with a validated path field as the fallback.

The terminal owns the local agent and Web UI server. Keep it open while using
the browser. Both interfaces share turns, streamed output, model changes,
approvals, cancellation, and context telemetry; do not open a stale saved Web UI
URL after the owning process exits.

Type `/` in the Web UI composer for command suggestions. Use arrow keys and
Enter to select, or `Ctrl+K` for the broader action palette.

## Providers and models

Run `orbit login` to add a profile, `orbit login --list` to inspect saved
profiles, or `orbit login --delete <provider>` to remove one. Credentials are
redacted from output and encrypted through native OS storage when available.

When configuring an OpenAI-compatible provider, enter its exact base URL. If it
requires `/v1`, include `/v1`; Orbit intentionally does not append or probe
alternative suffixes. After login, Orbit requests the provider's model catalog
and exposes returned models in `/model` and the Web UI selector.

The Ollama profile scans the local Ollama API for installed models. If the
service is stopped, start Ollama and refresh the selection rather than expecting
Orbit to invent a catalog.

Use `/model` to inspect or switch the active provider/model. A switch applies to
the next turn, preserves the current chat, and recalculates its context budget.
If the new model has a smaller window, Orbit compacts older dialogue while
keeping recent instructions and a stable summary.

Useful provider checks:

```bash
orbit config
orbit doctor --deepseek
orbit doctor --probe --deepseek
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
```

## Daily controls

Run `/help` for the live, localized command catalog. These are the controls most
useful in longer tasks:

| Command                    | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `/goal [text\|clear]`      | show, set, or clear the chat's durable objective          |
| `/plan [action]`           | manage recoverable steps and their status                 |
| `/model [name]`            | show or switch the active model                           |
| `/mode [mode]`             | switch `strict`, `normal`, `auto`, or `plan` permissions  |
| `/add <path>`              | add a file or directory to active context                 |
| `/drop <path>`             | remove a file or pattern from active context              |
| `/compact`                 | compact older dialogue for the active model window        |
| `/memory [action]`         | review or manage explicit project memory                  |
| `/metrics`                 | inspect local routing, tool, file, and compaction metrics |
| `/timeline`                | list persisted file checkpoints                           |
| `/rewind <id\|number>`     | restore a selected checkpoint                             |
| `/rollback`                | restore the latest file modification checkpoint           |
| `/run <command>` or `!cmd` | run a native command after permission checks              |
| `/update`                  | check/update Orbit itself through npm                     |

`/clear` resets dialogue history; it is not the same as deleting or archiving a
chat. Project memory is opt-in, secret-redacted, and never populated
automatically from chat or web content.

## Context, tools, and safety

Orbit builds a bounded context pack from selected files, symbols, references,
repository maps, retrieval, project instructions, recent dialogue, and explicit
memory. The context indicator is measured against the active model's automatic
compaction threshold, not just a fixed global token count.

The model can receive validated tools for workspace files, search, symbols,
shell commands, tests, Git, project inspection, live web search, source fetches,
and task plans. Connected MCP tools retain the server's JSON Schema. Inputs are
validated before approval or execution; output is bounded and redacted before
it re-enters model context.

Permission modes balance interruption and control:

- `strict` asks before consequential operations.
- `normal` allows routine safe work and asks for higher-risk actions.
- `auto` minimizes prompts within configured policy boundaries.
- `plan` keeps work read-only while the approach is developed.

Path verification still confines file operations to the workspace. A mode
change does not grant permission outside configured boundaries.

## Reusable project instructions

Use `ORBIT.md` for durable, human-reviewed project guidance. Keep it specific:
build commands, architecture boundaries, coding standards, and required
verification are more useful than broad prose.

Create custom slash commands as Markdown:

- Project: `.orbit/commands/*.md`
- User: `~/.orbit/commands/*.md`

Example `.orbit/commands/review.md`:

```markdown
---
description: Review a target for correctness, security, and missing tests
argumentHint: <path-or-scope>
---

Review $ARGUMENTS. Prioritize concrete bugs, regressions, and missing verification.
```

Invoke it as `/review packages/core`. Templates support `$ARGUMENTS`, `{{args}}`,
and `$1` through `$9`. Project commands override user commands; built-ins cannot
be shadowed.

`orbit extension <manifest> [--json]` validates a versioned, workspace-bound
extension contract. It does not install or execute third-party code. See the
[extension manifest reference](EXTENSIONS.md) for supported contributions and
permission declarations.

## Automation

Use `orbit exec` for scripts and CI:

```bash
orbit exec "Run the verification contract and fix the failure" --jsonl
orbit exec "Continue the saved task" --resume <session-id> --jsonl
```

JSONL mode never opens an interactive approval menu. Policy-approved operations
continue; operations that still require approval fail safely. The final event
contains the structured outcome.

|  Code | Meaning                      |
| ----: | ---------------------------- |
|   `0` | completed                    |
|   `2` | task or verification failure |
|   `4` | provider startup failure     |
| `130` | aborted                      |

Use `orbit exec --help` for the complete automation contract.

## Updates, cleanup, and uninstall

Orbit checks for a newer npm release once per interactive process without
blocking startup or installing anything. A blinking cat heart indicates an
available update.

```bash
orbit update --check
orbit update                 # asks before installation
orbit update --yes           # explicit non-interactive installation
orbit update --channel beta --check
```

The terminal `/update` flow can install after confirmation and verifies the
version exposed by npm. The Web UI flow is check-only so the running local
server never replaces itself. After a successful installation, the current TUI
and Web UI deliberately keep showing their immutable running version; exit and
relaunch `orbit`, then run `/webui` again. A green blinking heart means the
package is installed but this process still needs that restart.

Preview Orbit-owned data before deletion:

```bash
orbit clean --project
orbit clean --user
orbit clean --all
orbit clean --all --yes --json
```

Cleanup never removes project source, `ORBIT.md`, or `orbit.config.yaml`.
Interactive cleanup requires the exact confirmation `DELETE`; non-interactive
cleanup requires `--yes`. Remove the executable separately:

```bash
npm uninstall --global @orbit-build/cli
```

## Troubleshooting

| Symptom                            | Check                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| `node` or `npm` is not found       | install current Node.js LTS from nodejs.org, then open a new shell |
| `orbit` is not found               | verify npm works; confirm npm's global binary path is on `PATH`    |
| provider is unavailable            | run `orbit doctor --probe` and verify the saved login              |
| expected models are missing        | verify the exact base URL or start Ollama, then refresh            |
| Web UI is disconnected             | return to the owning terminal and run `/webui` again               |
| context is close to its limit      | use `/compact`; Orbit also compacts automatically                  |
| a file edit should be reverted     | inspect `/timeline`, then use `/rewind` or `/rollback`             |
| configuration appears inconsistent | run `orbit config`, then `orbit doctor --json`                     |

For every command and flag, use `orbit --help` or
`orbit <command> --help`. Report security issues through the
[security policy](../SECURITY.md); include the redacted doctor snapshot for
ordinary support issues.
