import { describe, it, expect } from "vitest";
import {
  buildAuthorizedKeysStartupScript,
  encodeStartupScript
} from "../../src/ssh-key.js";

describe("buildAuthorizedKeysStartupScript", () => {
  it("installs the public key into authorized_keys", () => {
    const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey anka-mcp";
    const script = buildAuthorizedKeysStartupScript(publicKey);
    expect(script).toContain("mkdir -p ~/.ssh");
    expect(script).toContain(publicKey);
    expect(script).toContain("authorized_keys");
  });

  it("base64-encodes for the controller startup_script field", () => {
    const script = buildAuthorizedKeysStartupScript("ssh-ed25519 AAA test");
    const encoded = encodeStartupScript(script);
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(script);
  });
});
