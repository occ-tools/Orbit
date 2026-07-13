# Commercial release checklist

This checklist separates automated engineering gates from product, legal, and
operational decisions that must be owned by the release team.

## Automated engineering gate

Run from a clean checkout using the supported pnpm version:

```bash
pnpm install --frozen-lockfile
pnpm verify:release
orbit doctor --json --strict
```

The gate must pass without ignored failures. It covers formatting, linting,
all workspace builds, the full Vitest suite, high-severity production dependency
auditing, CLI version consistency, executable command/config/diagnostic/init/text
REPL/LSP smoke testing, package allowlists, and artifact-size limits. GitHub
Actions repeats the contract on Node.js 20, 22, and 24 and on Windows, Linux,
and macOS.

## Credentialed provider smoke tests

CI must not receive production customer credentials. Before release, use a
dedicated low-privilege test account and record redacted results for:

```bash
orbit doctor --probe --deepseek --strict
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
orbit bench --model deepseek-v4-flash --thinking disabled --cache-profile --repeat 3
```

Cache hit rate and latency are observations, not release guarantees. A release
should fail only against an explicitly approved threshold and controlled test
profile.

## Manual product smoke tests

- Install the packed CLI into a clean user profile and verify `orbit --version`,
  `orbit login`, TUI startup, non-interactive `orbit exec`, and clean Ctrl+C.
- Open the Web UI, verify bootstrap authentication, chat, cancellation,
  settings, reconnect, narrow viewport layout, and keyboard-only operation.
- Verify the VS Code autocomplete extension against `orbit lsp`, including
  editor shutdown and rapid completion cancellation.
- Verify checkpoint creation, rollback, rewind after restart, protected-path
  approval, Git-unavailable fallback, and non-TTY text fallback.
- Confirm no test key, local path, `.orbit` state, source map, or private fixture
  appears in the npm package or support snapshot.

## Required owner decisions before public sale

- Choose and publish the software license/EULA and third-party notices. The
  repository intentionally does not infer a license from source availability.
- Decide whether only `@orbit-build/cli` is distributed or the current internal
  workspace packages become supported public SDKs.
- Publish privacy terms. Orbit currently has no opt-in telemetry pipeline; any
  future telemetry requires explicit consent, schema review, retention limits,
  and a documented disable path.
- Define supported operating systems, Node.js lifecycle, provider compatibility,
  update channels, deprecation windows, and customer support/SLA boundaries.
- Define package signing/provenance, release approvers, npm organization access,
  recovery keys, and an incident response owner.
- Review product name, trademarks, billing claims, provider pricing, and all
  performance claims with the appropriate legal and product owners.

## Release record

For every release, archive the commit, changelog entry, CI run, packed artifact
hash, dependency audit result, redacted provider smoke results, approver, and
rollback instructions. Never archive credentials or raw customer workspaces.
