import { describe, it, expect } from "vitest";
import { mcpMethodsFromBody, sanitizeForLog } from "../../src/log.js";

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
