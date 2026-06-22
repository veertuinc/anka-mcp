# Security Guide

anka-mcp is a **powerful VM control plane**. Any authenticated MCP client can start, access, and destroy VMs within enabled backends. Treat network exposure, tokens, and logging accordingly.

This guide maps [NSA CSI MCP Security considerations](https://www.nsa.gov/) to operator responsibilities for this server.

## Trust boundaries

```text
[MCP client / LLM]  --TLS?-->  [anka-mcp]  -->  [Anka controller API]
                                     |
                                     +-->  [local anka CLI / host VMs]
```

- **MCP clients are untrusted input sources** — tool args come from LLM-driven automation; validation is enforced server-side but agents remain privileged once authenticated.
- **anka-mcp should not be internet-facing without TLS**, a firewall, and per-client tokens.
- **Prefer local anka-mcp** when processing sensitive workloads on a developer machine.

## Authentication & tokens

### Multi-client model (recommended)

1. Set `MCP_ADMIN_TOKEN` to a strong random secret.
2. Start the server; use `POST /admin/tokens` to issue **one token per client/agent**.
3. Revoke tokens promptly with `DELETE /admin/tokens/:id`.

Properties:

- Admin token manages lifecycle only — it does **not** work on `/mcp`.
- Client tokens do **not** work on `/admin/*`.
- Only hashed token secrets are stored in SQLite (`MCP_DB_PATH`).
- Controller VMs are **scoped per token**; one client cannot get/terminate another's instances.
- Revoking a token blocks access immediately; with `MCP_REVOKE_CLEANUP=on` (default), owned controller VMs are terminated.

### Legacy shared token

`MCP_AUTH_TOKEN` still works as a single shared identity (`legacy`). Avoid in production multi-tenant setups — no per-client revocation or isolation bucket.

### Token hygiene

- Rotate `MCP_ADMIN_TOKEN` and client tokens on compromise or staff change.
- Never commit tokens to git or share via chat.
- Back up `anka-mcp.db` for disaster recovery.

## Network exposure

| Setting | Default | Guidance |
|---|---|---|
| `MCP_HTTP_HOST` | `127.0.0.1` | Localhost-only by default |
| Remote access | — | Set `MCP_HTTP_HOST=0.0.0.0` only behind TLS reverse proxy |
| `MCP_ALLOW_NO_AUTH` | off | **Never** on non-localhost |

### TLS

Terminate TLS in front of anka-mcp (nginx, Caddy, cloud load balancer). Bearer tokens and SSH private key paths must not travel over cleartext HTTP in production.

### Origin allow-list

Set `MCP_ALLOWED_ORIGINS` when browser-based MCP clients connect — mitigates DNS rebinding against browser sessions.

## DoS & resource limits

Configurable via environment (see README):

- Request body size cap (`MCP_MAX_BODY_BYTES`)
- Per-IP rate limit (`MCP_RATE_LIMIT_RPM`)
- Session idle timeout and max concurrent sessions
- Tool response size cap (`MCP_MAX_RESPONSE_CHARS`)
- Local running-VM cap (`ANKA_LOCAL_MAX_VMS`)

Lower rate limits in untrusted networks; raise for trusted internal automation.

## Logging & monitoring

- Request/tool logging goes to **stderr** by default (`MCP_LOG=on`).
- Optional append-only **`MCP_AUDIT_LOG`** file for retention.
- Passwords, private keys, and bearer tokens are redacted.
- Monitor for: auth failures, rate-limit events, unexpected destructive tool calls, admin token create/revoke.

Integrate stderr or audit log with your SIEM where available.

## Controller backend

- Set `ANKA_CONTROLLER_AUTH` with least-privilege controller credentials.
- **Do not** use `ANKA_CONTROLLER_TLS_INSECURE=1` in production.
- Controller `external_id` auto-records MCP client, IP, user-agent, session, and credential id for traceability.

## Local backend

- Run anka-mcp as an **unprivileged OS user** where possible.
- Consider AppArmor/SELinux on hosts running the local backend.
- Trust `ANKA_BIN` — it is executed via `execFile` (no shell), but a malicious path would run arbitrary code.

## Dependency & vulnerability tracking

```bash
npm audit
```

Watch advisories for:

- `@modelcontextprotocol/sdk`
- `express`, `better-sqlite3`, and other direct dependencies

Example ecosystem issue: CVE-2025-49596 (MCP Inspector RCE) — not this server, but illustrates MCP toolchain risk.

## Network scanning

Periodically scan your network for unauthorized MCP HTTP endpoints (tools such as MCP Scanner, Ramparts, CyberMCP). anka-mcp defaults to port **9111**.

## Out of scope for this server

These NSA recommendations are **operator/infrastructure** responsibilities:

- Cryptographic MCP message signing (rely on TLS + bearer auth)
- Outgoing DLP proxy for exfiltration prevention
- OS-level sandbox profiles (documented above as deployment guidance)
- Prompt-injection filtering in tool outputs (primarily the MCP client's job; we cap response size and minimize fields)

## Reporting issues

Report security concerns through your organization's normal channel for this repository.
