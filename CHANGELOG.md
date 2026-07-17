# Changelog

All notable user-facing changes are recorded here. Orbit is pre-1.0; minor
versions may still include configuration or API migrations, which must be
called out explicitly.

## 0.1.4 - 2026-07-17

### Added

- A production-grade Web UI conversation workspace with direct chat, live
  terminal synchronization, recent-session switching, searchable commands,
  file context selection, approval prompts, cancellation, and reconnect-safe
  drafts.
- Rich streamed responses for Markdown, tables, syntax-highlighted code,
  collapsible long blocks, tool progress, reasoning summaries, verification
  state, response copying, and jump-to-latest navigation.
- A cohesive responsive Orbit design system with the cat mark, light/dark/system
  themes, mobile navigation, a persistent desktop focus mode, keyboard shortcuts,
  accessible dialogs, and reduced-motion support.
- Model-aware `/compact` support, automatic context compaction, context-window
  telemetry, session titles, and production release/package auditing.

### Changed

- Reworked Web UI authentication and lifecycle handling around short-lived
  bootstrap credentials, authenticated cookies, bearer fallback, bounded SSE
  retries, and isolated server instances.
- Improved DeepSeek V4 Flash/Pro routing, cache-aware context construction,
  provider diagnostics, benchmark output, token budgeting, and streamed status
  reporting.
- Split the Web UI client, styles, approval flow, context picker, event stream,
  and runtime responsibilities into independently tested modules.
- Reduced session-switch latency by reusing the autocomplete candidate cache
  instead of rescanning the workspace for every Web UI navigation action.

### Fixed

- Prevented expired Web UI tabs from entering repeated unauthorized/reconnect
  loops while preserving drafts and providing a deterministic recovery path.
- Kept terminal and browser turns synchronized without duplicating history or
  routing slash commands through the wrong execution path.
- Preserved the npm `orbit` executable on Windows and kept CLI, workspace,
  extension, MCP, and package versions aligned for release.
- Hardened context paths, event payloads, approvals, cancellation, verification
  outcomes, session persistence, and sensitive diagnostic output.

## 0.1.3 - 2026-07-14

### Added

- Local authenticated Web UI with responsive chat, settings, cancellation, and
  live event streaming.
- DeepSeek V4 Flash/Pro routing, thinking-mode controls, cache telemetry,
  capability probes, and repeatable benchmarks.
- Persistent checkpoints, timeline rewind, custom slash commands, and
  cross-platform global CLI installation.
- Cross-platform CI, production dependency auditing, and CLI package-content
  verification.
- Versioned `doctor --json` support snapshots with strict automation status and
  workspace-path redaction.
- Explicit configuration schema versioning with safe legacy defaults and
  rejection of unsupported future formats.

### Changed

- Split the CLI command router, terminal UI, and Web UI into smaller ownership
  boundaries for safer maintenance.
- Hardened credential storage, workspace path verification, request redaction,
  and Web UI authentication.
- Bounded and validated LSP/MCP protocol input, redacted MCP process failures,
  and deterministic cleanup of autocomplete work.

### Fixed

- Prevented workspace traversal through added files and rollback paths.
- Prevented stopped Web UI instances from receiving events from later runs.
- Preserved prompt/history behavior and terminal fallback operation during the
  UI refactor.
