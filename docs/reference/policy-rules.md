# Policy rules

Thirteen pure security and policy rules.

| Code | Severity | Title |
|---|---|---|
| POL001 | warning | No top-level permissions block |
| POL002 | error | Third-party action not SHA-pinned |
| POL003 | error | Privileged token on an untrusted event |
| POL004 | error | Secret reachable from untrusted event |
| POL005 | warning | Broad `contents:write` on PR workflow |
| POL006 | warning | Deploy without environment gate |
| POL007 | error | Action ref uses a branch |
| POL008 | error | Shell injection from untrusted input |
| POL009 | warning | OIDC permission without a cloud step |
| POL010 | warning | Workflow modifies workflow files |
| AGENT001 | error | Untrusted input flows into an AI agent |
| AGENT002 | warning | Over-permitted AI agent |
| AGENT003 | error | Agent output executed |

Rules are grouped into six policy packs: `oss-maintainer`, `enterprise-least-privilege`, `release-hardening`, `ai-agent-safety`, `docker-publishing` and `cloud-deploy`.

![An AI-agent workflow graded F](../images/security.png)
