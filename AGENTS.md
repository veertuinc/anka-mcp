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
  - `controller_request_vm` / `controller_get_vm` -> instance state plus `ssh: { host, port, username, password }`; do not echo the full `vminfo`.
- On failure, return `{ ok: false, error }` (or throw a clear `Error`) with a concise message. Do not dump verbose command output.
- On success for action tools, return `{ ok: true, ... }` with just the identifying fields (e.g. the VM `name`).

When adding or changing a tool, ask: "Which of these fields will the agent actually use?" Return those and nothing else.
