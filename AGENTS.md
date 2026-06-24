# anka-mcp agent guidelines

## Keep tool output narrow and clean

MCP tool results are fed straight into an agent's context, so every field costs tokens and adds noise. Return only what the caller needs to act on.

- Return a small, hand-picked object. Never return the raw `runAnka()` result or a raw controller response.
- Never include CLI plumbing: no `stdout`, `stderr`, `args`, `exitCode`, or the duplicated JSON envelope.
- Drop fields the agent will not use (timestamps, sizes, versions, addons, disk/cpu specs, etc.) unless a tool's job is specifically to report them.
- Map upstream payloads to a minimal shape. Examples in this repo:
  - `local_list_templates` -> `{ name, uuid }` per VM only.
  - `local_show_vm` -> `{ ip }` only.
  - `controller_list_templates` -> `{ id, name, arch, tags: [{ tag, description }] }` per template.
  - `controller_request_vm` / `controller_get_vm` -> when SSH-ready: `{ instance_id, status: "ready", ssh: { host, port, username }, ssh_connect_hint }`; while provisioning: `{ status: "pending", ssh: null, message }`; if `ssh_public_key_base64` is omitted: `{ error, ssh_key_instructions }`; do not echo the full `vminfo`.
- **Controller VM workflow:** if `controller_request_vm` returns `status: "ready"` (e.g. `instance_state: "Started"`, `vm_status: "running"`, and `ssh` populated), use that response directly — **do not** call `controller_get_vm`. Poll `controller_get_vm` every 30 seconds only when `controller_request_vm` returns `status: "pending"` (template still pulling or SSH not yet available).
  - `controller_terminate_vm` -> `{ instance_id, terminated: true, ssh_key_cleanup }`; run the cleanup command so the next session does not hang on ssh-keygen overwrite.
  - `local_ssh_access` -> `{ ok, ip, port, user }` after installing the caller's public key.
- The agent generates and keeps the SSH **private** key locally. Pass only a base64-encoded **public** key line as `ssh_public_key_base64`. Never expect the MCP server to return private key material.
- If `controller_request_vm` or `local_ssh_access` returns `ssh_key_instructions`, follow them to create a keypair and retry with `ssh_public_key_base64`. Always `rm -f` the key path before `ssh-keygen` (avoids an interactive overwrite prompt). On session termination or when SSH is no longer needed, `rm -f` the private and public key files.
- On failure, return `{ ok: false, error }` (or throw a clear `Error`) with a concise message. Do not dump verbose command output.
- On success for action tools, return `{ ok: true, ... }` with just the identifying fields (e.g. the VM `name`).
