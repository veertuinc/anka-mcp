# Security Hardening — Change Log & Operator Notes

This document tracks each security hardening change applied per the [NSA MCP Security plan](.cursor/plans/nsa_mcp_security_hardening_60ed681b.plan.md). Read the section for any change you deploy or upgrade past.

> **Status:** Implemented. All sections below are active in the current codebase.

---

## Change 1 — Localhost-by-default binding

**Status: Done**

### What changed

- `MCP_HTTP_HOST` default is **`127.0.0.1`** (was `0.0.0.0`)
- On startup, if the bind address is **not** loopback, the server prints a stderr warning about network exposure and TLS

### Files

- `src/config.ts`
- `src/security/host.ts`
- `src/transports/http.ts`

### What you need to know

| Scenario | Action |
|---|---|
| Local dev on same machine | No change — default works |
| Remote / LAN / Docker publish | Set `MCP_HTTP_HOST=0.0.0.0` (or specific interface) |
| Production | Bind behind reverse proxy with **TLS**; firewall to trusted clients |

**Breaking:** Remote deployments that relied on the old `0.0.0.0` default must set `MCP_HTTP_HOST=0.0.0.0` explicitly.

---

## Change 2 — DoS limits (body size, rate limit, sessions)

**Status: Done**

### What changed

| Variable | Default | Purpose |
|---|---|---|
| `MCP_MAX_BODY_BYTES` | `1048576` (1 MiB) | Max JSON request body |
| `MCP_RATE_LIMIT_RPM` | `120` | Max requests per IP per minute (`/mcp` and `/admin`) |
| `MCP_SESSION_IDLE_MS` | `3600000` (1 h) | Idle MCP session eviction |
| `MCP_MAX_SESSIONS` | `50` | Max concurrent MCP sessions |
| `MCP_MAX_RESPONSE_CHARS` | `32768` (32 KiB) | Max serialized tool response size |

### Files

- `src/config.ts`
- `src/security/rate-limit.ts`
- `src/transports/http.ts`

### What you need to know

- Rate limit exceeded → **429** (`Too many requests`)
- Max sessions exceeded → **503** on new initialize
- Oversized body → **413** (Express default)
- Idle sessions evicted every 60s; clients must re-initialize after idle timeout
- Set `MCP_RATE_LIMIT_RPM=0` to disable rate limiting

---

## Change 3 — Extended audit logging

**Status: Done**

### What changed

New log events (stderr, and optionally `MCP_AUDIT_LOG` file):

| Event | When |
|---|---|
| `LIMIT REACHED …` | Rate limit, max sessions, body size, response size, session idle eviction, origin denied |
| `auth failure` | Invalid/missing bearer on `/mcp` or `/admin` |
| `session created` / `session closed` | MCP initialize / DELETE (includes actor) |
| `admin token created` / `admin token revoked` | Admin API (id + label only) |

All limit events use a consistent format:

```text
LIMIT REACHED MCP_RATE_LIMIT_RPM=120 by source=10.0.0.5 (Cursor/1.0) credential_id=… route=/mcp requests_in_window=121
```

### Files

- `src/log.ts`
- `src/transports/http.ts`
- `src/transports/admin.ts`

### What you need to know

- Set `MCP_AUDIT_LOG=/path/to/file` for append-only file retention
- `MCP_LOG=off` suppresses request/audit lines (startup banner still prints)
- Passwords, private keys, and bearer tokens are never logged

---

## Change 4 — Stronger input validation

**Status: Done**

### What changed

Shared Zod schemas in `src/security/schemas.ts`:

- `boundedName` — max 128 chars, no leading `-` (used as `vmNameSchema`)
- `uuidLike` — max 64 chars, `[a-zA-Z0-9._-]+`
- `optionalBoundedString` — max 512 chars
- `timeoutSecondsSchema` — max 3600 seconds

### Files

- `src/security/schemas.ts`
- All tool input schemas under `src/tools/local/` and `src/tools/controller/`

### What you need to know

- Invalid args rejected by Zod before any backend call
- IDs longer than 64 chars or names longer than 128 chars are rejected

---

## Change 5 — Sanitized errors and capped responses

**Status: Done**

### What changed

- Controller errors mapped to agent-safe messages (no URLs or raw HTTP bodies)
- `runControllerTool()` wraps controller tool handlers
- `ankaError()` sanitizes CLI stderr (strips paths, caps at 200 chars)
- `jsonResult()` truncates responses beyond `MCP_MAX_RESPONSE_CHARS`

### Files

- `src/security/sanitize.ts`
- `src/tools/controller/results.ts`
- `src/tools/local/vms.ts`
- `src/tools/define-tool.ts`

### What you need to know

- Agents see generic controller errors; use server stderr for detailed controller debug (`controller GET /api/... -> failed: ...`)
- Truncated responses include `"truncated": true`

---

## Change 6 — Security documentation

**Status: Done**

- [`SECURITY.md`](SECURITY.md) — operator guide
- [`README.md`](README.md) — new env vars, remote deployment section, link to SECURITY.md

---

## Change 7 — Tests

**Status: Done**

| Test file | Covers |
|---|---|
| `test/unit/config.test.ts` | Localhost default, limit env vars |
| `test/unit/sanitize.test.ts` | Error sanitization |
| `test/unit/schemas.test.ts` | Bounded schema rejection |
| `test/e2e/security.test.ts` | Rate limit, body limit, origin guard, auth logging, sanitized errors |

Run `npm test` after upgrading.

---

## Quick migration checklist

- [ ] Set `MCP_HTTP_HOST=0.0.0.0` if you expose anka-mcp beyond localhost
- [ ] Terminate TLS in front of the HTTP endpoint
- [ ] Prefer per-client tokens via admin API over shared `MCP_AUTH_TOKEN`
- [ ] Set `MCP_ALLOWED_ORIGINS` if browser-based clients connect
- [ ] Redirect stderr or set `MCP_AUDIT_LOG` for retention
- [ ] Review rate/session limits for your traffic profile
- [ ] Run `npm test` after deploy

---

## Already in place (prior to this pass)

- **Multi-client tokens** — `MCP_ADMIN_TOKEN`, SQLite store, `/admin/tokens`
- **Controller VM isolation** — per-token instance ownership
- **Revoke cleanup** — `MCP_REVOKE_CLEANUP=on`
- **Request-scoped logging** — IP, user-agent, credential id, redacted tool args
- **Curated tools only** — `execFile` for anka CLI; no generic shell tool
- **Bearer auth** — timing-safe compare, fail-closed startup
