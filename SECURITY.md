# Security Policy

## Supported versions

Orbit is under active pre-1.0 development. Security fixes are applied to the
latest released version and the current default branch. Older pre-1.0 builds
are not guaranteed to receive backports.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include API keys,
credentials, private source code, or unredacted diagnostic output in a report.

Use the repository's
[private vulnerability reporting](https://github.com/Hephaestus-DevKit/Orbit/security/advisories/new)
flow. Include the affected version, operating system, reproduction steps,
impact, and the smallest safe proof of concept you can provide.

We will acknowledge a complete report as soon as maintainers are available,
keep investigation details private while a fix is prepared, and coordinate
disclosure after affected users have a reasonable upgrade path.

## Security model

- Provider credentials belong in `orbit login` or environment variables, not
  project configuration committed to source control.
- Project configuration cannot enable executable hooks, MCP servers, automatic
  repair, or weaker permissions unless executable project configuration was
  explicitly trusted from the user's global configuration.
- The Web UI binds only to loopback, requires a random bearer secret, exchanges
  it for an HttpOnly same-site cookie, validates same-origin requests, and
  applies bounded request parsing and restrictive browser headers.
- File tools verify workspace boundaries and protected-path policy before
  accessing user files.

These controls reduce risk but do not make arbitrary third-party instructions,
MCP servers, shell commands, or model output inherently trustworthy. Review
permission prompts and keep backups for important workspaces.
