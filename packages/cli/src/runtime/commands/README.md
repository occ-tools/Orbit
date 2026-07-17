# Runtime command handlers

This directory owns focused slash-command behavior used by `CommandRouter`.
The router expands custom commands, delegates to these handlers, and retains
only small process-level commands whose state cannot yet be cleanly isolated.

## File map

| Module                             | Responsibility                                                        |
| ---------------------------------- | --------------------------------------------------------------------- |
| `CommandHandlerTypes.ts`           | Shared handled/not-handled result and output contracts.               |
| `ShellCommandHandler.ts`           | `!` and `/run`, including permission approval.                        |
| `WorkspaceConfigCommandHandler.ts` | Validated direct and interactive `/config` updates.                   |
| `ContextCommandHandler.ts`         | `/add`, `/drop`, `/compact`, and `/clear` context/history operations. |
| `RollbackCommandHandler.ts`        | Safe Git/checkpoint `/rollback` selection and execution.              |
| `SessionCommandHandler.ts`         | `/chat` list, create, resume, delete, and picker flows.               |

Each implementation has a colocated Vitest file. Dependencies that touch
prompts, Git, or process state should be injected through a narrow adapter so
tests remain deterministic.

## Boundaries

- Return `null` for an unrelated command and `HANDLED_COMMAND` after handling.
- Validate external values before mutating config, session, or filesystem state.
- Resolve every user- or Git-provided path with `resolveSafePath` before any
  `stat`, glob, read, checkout, or removal operation.
- Prefer argument-array process APIs such as `execFileSync` over shell strings.
- Keep display text localized and send output through the injected output
  function so terminal and event consumers remain consistent.

Run `pnpm test:cli` for package tests or `pnpm verify:cli` for the complete CLI
verification contract.
