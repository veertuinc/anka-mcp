# anka-mcp agent guidelines

## Keep tool output narrow and clean

MCP tool results are fed straight into an agent's context, so every field costs tokens and adds noise. Return only what the caller needs to act on.

- Return a small, hand-picked object. Never return the raw `runAnka()` result or a raw controller response.
- Never include CLI plumbing: no `stdout`, `stderr`, `args`, `exitCode`, or the duplicated JSON envelope.
- Drop fields the agent will not use (timestamps, sizes, versions, addons, disk/cpu specs, etc.) unless a tool's job is specifically to report them.
- Map upstream payloads to a minimal shape. Examples in this repo:
  - `local_list_templates` -> `{ name, uuid }` per VM only.
  - `local_show_vm` -> `{ ip }` only.
  - `controller_list_templates` -> `{ id, name, arch }` per template.
  - `controller_request_vm` / `controller_get_vm` -> when SSH-ready: `{ instance_id, status: "ready", ssh: { host, port, username }, ssh_connect_hint }`; while provisioning: `{ status: "pending", ssh: null, message }`; if `ssh_public_key_base64` is omitted: `{ error, ssh_key_instructions }`; do not echo the full `vminfo`.
  - `local_ssh_access` -> `{ ok, ip, port, user }` after installing the caller's public key.
- The agent generates and keeps the SSH **private** key locally. Pass only a base64-encoded **public** key line as `ssh_public_key_base64`. Never expect the MCP server to return private key material.
- If `controller_request_vm` or `local_ssh_access` returns `ssh_key_instructions`, follow them to create a keypair and retry with `ssh_public_key_base64`.
- On failure, return `{ ok: false, error }` (or throw a clear `Error`) with a concise message. Do not dump verbose command output.
- On success for action tools, return `{ ok: true, ... }` with just the identifying fields (e.g. the VM `name`).

## Controller VM SSH — wait before connecting

The controller may report `status: "ready"` and an SSH endpoint **before** the VM's `startup_script` has finished installing your public key in `authorized_keys`. Connecting too early causes `Permission denied` or `Too many authentication failures` (especially if ssh-agent offers other keys).

1. **While `status` is `"pending"`** — poll `controller_get_vm` every 30 seconds. **Do not SSH.**
2. **When `status` is `"ready"`** — read `ssh_connect_hint`, then **wait ~20 seconds** before the first SSH attempt.
3. **Connect with only your VM key** — disable ssh-agent and force the one identity:

```bash
SSH_AUTH_SOCK= ssh -i ./anka_vm_key -p <port> \
  -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  <username>@<host> true
```

4. **If auth fails** — wait 20 seconds and retry (startup_script may still be running). Do not blast retries; that triggers "Too many authentication failures".

When adding or changing a tool, ask: "Which of these fields will the agent actually use?" Return those and nothing else.
