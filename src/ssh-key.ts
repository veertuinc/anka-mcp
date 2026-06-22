import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SshKeypair {
  privateKeyPath: string;
  publicKey: string;
}

/** Generate a throwaway ed25519 keypair in a temp dir. */
export async function generateSshKeypair(): Promise<SshKeypair> {
  const dir = await mkdtemp(join(tmpdir(), "anka-mcp-ssh-"));
  const privateKeyPath = join(dir, "id_ed25519");
  await execFileAsync("ssh-keygen", [
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    "anka-mcp",
    "-f",
    privateKeyPath,
    "-q"
  ]);
  const publicKey = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim();
  return { privateKeyPath, publicKey };
}

/** Shell script that installs `publicKey` into ~/.ssh/authorized_keys. */
export function buildAuthorizedKeysStartupScript(publicKey: string): string {
  const escaped = publicKey.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
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

export function buildSshCommand(options: {
  privateKeyPath: string;
  host: string;
  port: number;
  user: string;
}): string {
  return (
    `ssh -i ${options.privateKeyPath} -p ${options.port} ` +
    `-o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ` +
    `${options.user}@${options.host}`
  );
}
