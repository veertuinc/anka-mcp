import { Buffer } from "node:buffer";

export const TEST_PUBLIC_KEY_LINE =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyForTests anka-mcp-test";

export const TEST_PUBLIC_KEY_BASE64 = Buffer.from(TEST_PUBLIC_KEY_LINE, "utf8").toString("base64");
