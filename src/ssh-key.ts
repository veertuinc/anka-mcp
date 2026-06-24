/** Instructions returned when the caller omits ssh_public_key_base64. */
export const SSH_PUBLIC_KEY_INSTRUCTIONS =
  "Create an ed25519 keypair on the agent machine:\n" +
  '  ssh-keygen -t ed25519 -N "" -C "anka-vm" -f ./anka_vm_key\n' +
  "Base64-encode the single-line public key file:\n" +
  "  Linux: base64 -w0 < ./anka_vm_key.pub\n" +
  "  macOS: base64 < ./anka_vm_key.pub | tr -d '\\n'\n" +
  "Pass the result as ssh_public_key_base64 to controller_request_vm.\n" +
  "Once the VM is ready, SSH in with the matching private key:\n" +
  "  ssh -i ./anka_vm_key -p <port> -o IdentitiesOnly=yes -o StrictHostKeyChecking=no <username>@<host>";

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
