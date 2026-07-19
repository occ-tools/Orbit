# Orbit extension manifests

Orbit validates extension contracts before any future installation or runtime
activation. Validation does not execute the extension:

```powershell
orbit extension .orbit/extensions/review/orbit.extension.yaml
orbit extension .orbit/extensions/review/orbit.extension.yaml --json
```

The version 1 manifest declares an extension ID and version, compatible Orbit
versions, contribution paths, and requested permissions. Supported contribution
metadata covers commands, skills, agents, tools, lifecycle hooks, MCP servers,
and templates. All contribution paths must be relative to the extension; MCP
manifests may inherit named environment variables but cannot embed raw secret
values.

Manifest validation is intentionally separate from trust. A valid manifest is
not automatically safe, installed, enabled, or allowed to execute. Runtime
activation must route every hook, tool, MCP call, filesystem scope, network
destination, process launch, and credential request through Orbit's permission
and audit layers.
