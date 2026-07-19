# Orbit documentation

- [Maintainer guide](MAINTAINER_GUIDE.md): code ownership, change locations,
  safety invariants, verification commands, and troubleshooting.
- [CLI competitive roadmap](CLI_COMPETITIVE_ROADMAP.md): longer-term product
  and architecture direction.
- [Commercial release checklist](COMMERCIAL_RELEASE_CHECKLIST.md): automated
  gates, provider/platform smoke tests, and owner decisions required before sale.
- [Commercial decisions](COMMERCIAL_DECISIONS.md): legal, privacy, distribution,
  support, incident-response, and branding choices that require an owner.
- [Extension manifest v1](EXTENSIONS.md): validated extension metadata,
  permission declarations, compatibility rules, and current loading limits.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): generated production
  dependency license inventory.
- [Repository README](../README.md): installation, usage, DeepSeek profile, and
  user-facing features.
- [Agent guidelines](../AGENTS.md): required code, UX, security, and test
  standards for automated changes.

Feature-specific implementation notes live next to the code they describe:

- [Runtime command handlers](../packages/cli/src/runtime/commands/README.md)
- [Full-screen TUI](../packages/cli/src/tui/README.md)
- [Web UI runtime](../packages/cli/src/runtime/webui/README.md)
- [Agent runtime](../packages/core/src/agent/README.md)
