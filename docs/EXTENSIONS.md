# Orbit extension manifests

Orbit validates extension contracts independently from installation. Validation
does not execute or install the extension:

```powershell
orbit extension .orbit/extensions/review/orbit.extension.yaml
orbit extension .orbit/extensions/review/orbit.extension.yaml --json
```

Install only a manifest you have reviewed. Contributions requesting process,
network, credentials, write access, hooks, or MCP require explicit trust:

```powershell
orbit extension-install .orbit/extensions/review/orbit.extension.yaml
orbit extension-install .orbit/extensions/review/orbit.extension.yaml --trust
orbit extension-list
orbit extension-remove com.example.review
```

Installation copies bounded, non-symlinked files into `~/.orbit/extensions`,
records a SHA-256 digest, and materializes prompt commands and skills under
Orbit-owned user directories. At startup, trusted MCP contributions are loaded
only when the installed digest and manifest ID still match. Tampered entries
are ignored. Removal deletes only the matching Orbit-managed extension path.

The version 1 manifest declares an extension ID and version, compatible Orbit
versions, contribution paths, and requested permissions. Supported contribution
metadata covers commands, skills, agents, tools, lifecycle hooks, MCP servers,
and templates. All paths must remain inside the extension.

Manifests may name credential environment variables but cannot embed common
credential headers. An HTTP MCP server must declare its exact destination host;
a stdio MCP server must request process permission.

Manifest validation is intentionally separate from trust. A valid manifest is
not automatically safe. Orbit currently activates prompt commands, skills, and
trusted MCP definitions; it deliberately does not import arbitrary extension
JavaScript or silently execute declared lifecycle hooks/tools. Those surfaces
remain metadata until a sandboxed runtime is available.
