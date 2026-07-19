# Commercial decisions requiring product-owner approval

Orbit's engineering gates cannot decide legal rights or business promises. The
items below must be approved by the product owner and reviewed by qualified
legal counsel before paid distribution. Until then, repository visibility does
not grant permission to use, modify, or redistribute Orbit.

| Decision             | Current technical state                                                                           | Required owner input                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Orbit license/EULA   | No Orbit license is declared                                                                      | Choose the source and binary license, warranty disclaimer, commercial-use terms, and governing jurisdiction                |
| Distribution surface | Only `@orbit-build/cli` is treated as the supported product                                       | Confirm whether internal workspace packages remain unsupported implementation details                                      |
| Privacy terms        | Local-first; configured providers receive selected prompts/context; no default telemetry pipeline | Name the data controller, contact, regions, provider subprocessors, retention/deletion periods, and applicable user rights |
| Support policy       | Diagnostics and redacted support traces exist                                                     | Define supported OS/Node/provider versions, response targets, exclusions, and deprecation windows                          |
| Incident response    | Release provenance, audits, and rollback records exist                                            | Name security contacts, escalation owner, disclosure channel, and notification commitments                                 |
| Branding and claims  | Orbit and provider names appear in product copy                                                   | Approve trademarks, pricing/performance claims, and required provider disclaimers                                          |

## Approval record

Do not replace placeholders with assumptions. Record the approver, date,
reviewed document revision, and external counsel reference for every completed
decision. Add the final license, privacy terms, and support policy as dedicated
top-level documents and link them from the npm README before public sale.
