import { describe, it, expect } from "vitest";
import {
  buildControllerExternalId,
  mcpMethodsFromBody,
  runWithRequestContext,
  sanitizeForLog
} from "../../src/log.js";

describe("sanitizeForLog", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      sanitizeForLog({
        user: "anka",
        password: "secret",
        ssh: { host: "10.0.0.1", password: "admin", private_key: "key-material" }
      })
    ).toEqual({
      user: "anka",
      password: "[redacted]",
      ssh: { host: "10.0.0.1", password: "[redacted]", private_key: "[redacted]" }
    });
  });
});

describe("mcpMethodsFromBody", () => {
  it("extracts method names from single and batched JSON-RPC bodies", () => {
    expect(mcpMethodsFromBody({ method: "initialize" })).toEqual(["initialize"]);
    expect(
      mcpMethodsFromBody([
        { method: "tools/list" },
        { method: "tools/call", params: { name: "local_show_vm" } }
      ])
    ).toEqual(["tools/list", "tools/call"]);
  });
});

describe("buildControllerExternalId", () => {
  it("includes MCP client, IP, user-agent, session, credential id, and caller ref", () => {
    const externalId = runWithRequestContext(
      {
        source: "127.0.0.1 (Cursor/3.8.11 (darwin arm64))",
        ip: "127.0.0.1",
        userAgent: "Cursor/3.8.11 (darwin arm64)",
        sessionId: "cf72ddba-98e6-4a4c-b0be-6b46be70c9e4",
        mcpClientName: "cursor-vscode",
        mcpClientVersion: "1.0.0",
        credentialId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      },
      () => buildControllerExternalId("my-build")
    );
    expect(externalId).toContain("anka-mcp");
    expect(externalId).toContain("client=cursor-vscode/1.0.0");
    expect(externalId).toContain("ip=127.0.0.1");
    expect(externalId).toContain("ua=Cursor/3.8.11 (darwin arm64)");
    expect(externalId).toContain("session=cf72ddba-98e6-4a4c-b0be-6b46be70c9e4");
    expect(externalId).toContain("credential_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(externalId).toContain("ref=my-build");
  });
});
