# CLI full-screen TUI

The TUI is split by state ownership. `FullscreenTui` coordinates the main
conversation screen while focused modules own prompt sessions, terminal text,
history persistence, paging, and theme constants.

## File map

| Module                 | Responsibility                                                   |
| ---------------------- | ---------------------------------------------------------------- |
| `FullscreenTui.ts`     | Conversation lifecycle, streaming state, and main-screen render. |
| `TuiPromptSession.ts`  | Prompt state machine, key handling, listeners, and raw mode.     |
| `TuiPromptView.ts`     | Pure full-screen prompt rendering.                               |
| `InputHistoryStore.ts` | Validated best-effort command-history persistence.               |
| `TerminalText.ts`      | ANSI-safe width, wrapping, truncation, and cursor layout.        |
| `TuiInputHelpers.ts`   | Pure history, Unicode editing, mouse, and completion helpers.    |
| `TextPager.ts`         | Interactive long-text paging with non-TTY fallback.              |
| `TuiTheme.ts`          | Curated Morandi color tokens.                                    |

## Lifecycle

1. Construction only initializes in-memory state.
2. `initialize()` installs process hooks and loads history idempotently.
3. `start()` enters the alternate screen and begins interaction.
4. `stop()` leaves the alternate screen but allows a later restart.
5. `dispose()` removes listeners, restores process hooks, and releases timers.

Do not import `CommandRouter` from this directory; shared command metadata lives
under `runtime/`. New pure layout or input behavior belongs in a focused module
with direct Vitest coverage rather than another large method on `FullscreenTui`.
