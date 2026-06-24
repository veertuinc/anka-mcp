/** Default path for the agent-generated SSH keypair (under /tmp, ephemeral). */
export const ANKA_MCP_SSH_KEY_PATH = "/tmp/anka_mcp_ssh_key";

/** Reminder to delete the agent keypair after SSH is no longer needed. */
export const SSH_KEY_CLEANUP_INSTRUCTIONS =
  "Delete the agent SSH keypair so the next run does not hang on ssh-keygen overwrite:\n" +
  `  rm -f ${ANKA_MCP_SSH_KEY_PATH} ${ANKA_MCP_SSH_KEY_PATH}.pub`;

/** Instructions returned when the caller omits ssh_public_key_base64. */
export const SSH_PUBLIC_KEY_INSTRUCTIONS =
  "Create an ed25519 keypair on the agent machine (remove any prior key first — ssh-keygen prompts interactively if the path exists):\n" +
  `  rm -f ${ANKA_MCP_SSH_KEY_PATH} ${ANKA_MCP_SSH_KEY_PATH}.pub\n` +
  `  ssh-keygen -t ed25519 -N "" -C "anka-mcp" -f ${ANKA_MCP_SSH_KEY_PATH} -q\n` +
  "Base64-encode the single-line public key file:\n" +
  `  Linux: base64 -w0 < ${ANKA_MCP_SSH_KEY_PATH}.pub\n` +
  `  macOS: base64 < ${ANKA_MCP_SSH_KEY_PATH}.pub | tr -d '\\n'\n` +
  "Pass the result as ssh_public_key_base64 to controller_request_vm.\n" +
  "If request_vm returns status ready with ssh, use it directly — do not call controller_get_vm.\n" +
  "Only if request_vm returns status pending, poll controller_get_vm every 30 seconds until status is ready and ssh is populated.\n" +
  "Wait ~20 seconds after status becomes ready before the first SSH attempt (startup_script installs the key at boot).\n" +
  "Connect with IdentitiesOnly=yes and disable ssh-agent to avoid authentication failures:\n" +
  `  SSH_AUTH_SOCK= ssh -i ${ANKA_MCP_SSH_KEY_PATH} -p <port> -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null <username>@<host>\n` +
  "If auth fails, wait 20 seconds and retry before giving up.\n" +
  "When finished or on session termination:\n" +
  SSH_KEY_CLEANUP_INSTRUCTIONS;

/** Shown when a controller VM reports SSH endpoint details but the agent should not connect yet. */
export const SSH_CONNECT_GUIDANCE =
  "Wait ~20 seconds after status is ready before the first SSH attempt — startup_script may still be installing your public key. " +
  "Use SSH_AUTH_SOCK= ssh -i <your-private-key> -p <port> -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null <user>@<host>. " +
  "If you see Permission denied or Too many authentication failures, wait 20 seconds and retry (do not offer other keys from ssh-agent).";

const OPENSSH_PUBLIC_KEY_LINE =
  /^ssh-(?:ed25519|rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/]+=*(?: .+)?$/;

/** Decode and validate a base64-encoded OpenSSH public key line. */
export function decodeSshPublicKeyBase64(encoded: string): string {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error("ssh_public_key_base64 must not be empty");
  }

  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
  } catch {
    throw new Error("ssh_public_key_base64 is not valid base64");
  }

  if (!OPENSSH_PUBLIC_KEY_LINE.test(decoded)) {
    throw new Error(
      "Decoded ssh_public_key_base64 must be an OpenSSH public key line (for example ssh-ed25519 AAAA... comment)"
    );
  }

  return decoded;
}

/** Shell script that installs `publicKeyLine` into ~/.ssh/authorized_keys. */
export function buildAuthorizedKeysStartupScript(publicKeyLine: string): string {
  const escaped = publicKeyLine.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
  return (
    "set -e; " +
    "mkdir -p ~/.ssh; chmod 700 ~/.ssh; " +
    `grep -qxF '${escaped}' ~/.ssh/authorized_keys 2>/dev/null || printf '%s\\n' '${escaped}' >> ~/.ssh/authorized_keys; ` +
    "chmod 600 ~/.ssh/authorized_keys"
  );
}

/** Base64-encode a startup script for the controller API `startup_script` field. */
export function encodeStartupScript(script: string): string {
  return Buffer.from(script, "utf8").toString("base64");
}
