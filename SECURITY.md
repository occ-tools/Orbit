# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository's
GitHub **Security** tab using a private vulnerability report. Do not open a
public issue for credentials exposure, workspace-boundary bypasses, command
execution flaws, authentication weaknesses, or other exploitable behavior.

Include the affected Orbit version, operating system, a minimal reproduction,
the expected security boundary, and the observed impact. Remove API keys,
customer source code, session histories, and other private data before
submitting evidence.

The maintainers will acknowledge a complete report, assess severity, coordinate
a fix and disclosure, and publish upgrade guidance when remediation is ready.
Exact response-time commitments belong in the commercial support agreement and
are not implied by this repository policy.

## Supported versions

Security fixes are made against the latest published minor line. Users should
upgrade to the newest patch release before reporting an issue that may already
be resolved. Pre-release builds and unreleased source snapshots are provided
for evaluation and are not supported production releases.

## Security model

Orbit is local-first, but it can execute commands, modify workspace files, and
send selected context to configured model or search providers. Keep permission
mode appropriate to the workspace, review approval prompts, use least-privilege
provider credentials, and never expose the local Web UI authentication token.

The maintained trust boundaries, abuse cases, mitigations, and release-time
security checks are documented in
[docs/SECURITY_THREAT_MODEL.md](docs/SECURITY_THREAT_MODEL.md).
