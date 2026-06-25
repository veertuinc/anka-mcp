#!/usr/bin/env bash
# Create a new MCP client token via the anka-mcp admin API.
#
# Requires ANKA_MCP_ADMIN_TOKEN in the environment (same value the server uses).
#
# Usage:
#   ANKA_MCP_ADMIN_TOKEN=... ./scripts/create-mcp-token.sh [label]
#
# Optional env:
#   ANKA_MCP_URL   Base URL (default: http://127.0.0.1:9111)
#   ANKA_MCP_HTTP_HOST  Host when ANKA_MCP_URL is unset (default: 127.0.0.1)
#   ANKA_MCP_HTTP_PORT  Port when ANKA_MCP_URL is unset (default: 9111)

set -euo pipefail

label="${1:-}"
host="${ANKA_MCP_HTTP_HOST:-127.0.0.1}"
port="${ANKA_MCP_HTTP_PORT:-9111}"
base_url="${ANKA_MCP_URL:-http://${host}:${port}}"

if [[ -z "${ANKA_MCP_ADMIN_TOKEN:-}" ]]; then
  echo "error: ANKA_MCP_ADMIN_TOKEN is not set" >&2
  exit 1
fi

request_body="$(
  LABEL="$label" python3 -c 'import json, os; print(json.dumps({"label": os.environ.get("LABEL", "")}))'
)"

response="$(
  curl -sS -w $'\n%{http_code}' -X POST "${base_url}/admin/tokens" \
    -H "Authorization: Bearer ${ANKA_MCP_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$request_body"
)"

http_code="${response##*$'\n'}"
response_body="${response%$'\n'*}"

if [[ "$http_code" != "201" ]]; then
  echo "error: admin API returned HTTP ${http_code}" >&2
  echo "$response_body" >&2
  exit 1
fi

echo "$response_body" | python3 -c '
import json, sys

data = json.load(sys.stdin)
if not data.get("ok"):
    print("error:", data.get("error", data), file=sys.stderr)
    sys.exit(1)

token_id = data["id"]
label = data.get("label") or "(none)"
token = data["token"]

print(f"id:    {token_id}")
print(f"label: {label}")
print(f"token: {token}")
print()
print("Use in your MCP client (shown once; not stored by the server):")
print(f"  Authorization: Bearer {token}")
'
