import { describe, it, expect } from "vitest";
import {
  ANKA_MCP_SSH_KEY_PATH,
  buildAuthorizedKeysStartupScript,
  decodeSshPublicKeyBase64,
  encodeStartupScript,
  SSH_KEY_CLEANUP_INSTRUCTIONS,
  SSH_PUBLIC_KEY_INSTRUCTIONS
} from "../../src/ssh-key.js";

const TEST_PUBLIC_KEY_LINE =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForTests anka-mcp-test";
const TEST_PUBLIC_KEY_BASE64 = Buffer.from(TEST_PUBLIC_KEY_LINE, "utf8").toString("base64");

describe("decodeSshPublicKeyBase64", () => {
  it("decodes a valid OpenSSH public key line", () => {
    expect(decodeSshPublicKeyBase64(TEST_PUBLIC_KEY_BASE64)).toBe(TEST_PUBLIC_KEY_LINE);
  });

  it("rejects invalid base64 content", () => {
    expect(() => decodeSshPublicKeyBase64("!!!")).toThrow(/valid base64|OpenSSH public key/i);
  });

  it("rejects decoded content that is not an OpenSSH public key line", () => {
    expect(() => decodeSshPublicKeyBase64(Buffer.from("hello", "utf8").toString("base64"))).toThrow(
      /OpenSSH public key/i
    );
  });
});

describe("SSH_KEY_CLEANUP_INSTRUCTIONS", () => {
  it("documents how to remove the agent keypair", () => {
    expect(SSH_KEY_CLEANUP_INSTRUCTIONS).toMatch(new RegExp(`rm -f ${ANKA_MCP_SSH_KEY_PATH}`));
    expect(SSH_KEY_CLEANUP_INSTRUCTIONS).toMatch(/ssh-keygen overwrite/i);
  });
});

describe("SSH_PUBLIC_KEY_INSTRUCTIONS", () => {
  it("documents key generation and how to pass ssh_public_key_base64", () => {
    expect(SSH_PUBLIC_KEY_INSTRUCTIONS).toMatch(/ssh-keygen -t ed25519/i);
    expect(SSH_PUBLIC_KEY_INSTRUCTIONS).toMatch(/ssh_public_key_base64/i);
    expect(SSH_PUBLIC_KEY_INSTRUCTIONS).toMatch(new RegExp(`rm -f ${ANKA_MCP_SSH_KEY_PATH}`));
    expect(SSH_PUBLIC_KEY_INSTRUCTIONS).toMatch(/session termination/i);
  });
});

describe("buildAuthorizedKeysStartupScript", () => {
  it("installs the public key into authorized_keys", () => {
    const script = buildAuthorizedKeysStartupScript(TEST_PUBLIC_KEY_LINE);
    expect(script).toContain("mkdir -p ~/.ssh");
    expect(script).toContain(TEST_PUBLIC_KEY_LINE);
    expect(script).toContain("authorized_keys");
  });

  it("base64-encodes for the controller startup_script field", () => {
    const script = buildAuthorizedKeysStartupScript(TEST_PUBLIC_KEY_LINE);
    const encoded = encodeStartupScript(script);
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(script);
  });
});
