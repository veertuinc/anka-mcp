import { afterEach, describe, expect, it } from "vitest";
import { startMockController, type MockController } from "../helpers/controllerMock.js";
import {
  connect,
  rawInitialize,
  startServer,
  type RunningServer
} from "../helpers/mcp.js";

let srv: RunningServer | undefined;
let mock: MockController | undefined;

afterEach(() => {
  srv?.stop();
  srv = undefined;
  void mock?.close();
  mock = undefined;
});

describe("origin guard", () => {
  it("rejects disallowed Origin headers", async () => {
    mock = await startMockController();
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: mock.url,
      MCP_AUTH_TOKEN: "secret",
      MCP_ALLOWED_ORIGINS: "https://allowed.example"
    });

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer secret",
        Origin: "https://evil.example"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }
      })
    });
    expect(res.status).toBe(403);
    expect(srv.stderr()).toMatch(/LIMIT REACHED MCP_ALLOWED_ORIGINS=/);
    expect(srv.stderr()).toMatch(/origin=https:\/\/evil\.example/);
  });
});

describe("rate limiting", () => {
  it("returns 429 after exceeding MCP_RATE_LIMIT_RPM", async () => {
    mock = await startMockController();
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: mock.url,
      MCP_AUTH_TOKEN: "secret",
      MCP_RATE_LIMIT_RPM: "2"
    });

    expect(await rawInitialize(srv.baseUrl, "secret")).toBe(200);
    expect(await rawInitialize(srv.baseUrl, "secret")).toBe(200);
    expect(await rawInitialize(srv.baseUrl, "secret")).toBe(429);
    expect(srv.stderr()).toMatch(/LIMIT REACHED MCP_RATE_LIMIT_RPM=2 by source=/);
    expect(srv.stderr()).toMatch(/requests_in_window=2/);
    expect(srv.stderr()).toMatch(/route=\/mcp/);
  });
});

describe("request body limit", () => {
  it("rejects oversized JSON bodies", async () => {
    mock = await startMockController();
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: mock.url,
      MCP_AUTH_TOKEN: "secret",
      MCP_MAX_BODY_BYTES: "256"
    });

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer secret"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "x".repeat(500), version: "0" }
        }
      })
    });
    expect(res.status).toBe(413);
    expect(srv.stderr()).toMatch(/LIMIT REACHED MCP_MAX_BODY_BYTES=256 by source=/);
    expect(srv.stderr()).toMatch(/body_too_large/);
  });
});

describe("max concurrent sessions", () => {
  it("returns 503 and logs when MCP_MAX_SESSIONS is reached", async () => {
    mock = await startMockController();
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: mock.url,
      MCP_AUTH_TOKEN: "secret",
      MCP_MAX_SESSIONS: "1"
    });

    expect(await rawInitialize(srv.baseUrl, "secret")).toBe(200);
    expect(await rawInitialize(srv.baseUrl, "secret")).toBe(503);
    expect(srv.stderr()).toMatch(/LIMIT REACHED MCP_MAX_SESSIONS=1 by source=/);
    expect(srv.stderr()).toMatch(/active_sessions=1/);
    expect(srv.stderr()).toMatch(/route=\/mcp/);
  });
});

describe("auth failure logging", () => {
  it("logs auth failures to stderr", async () => {
    mock = await startMockController();
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: mock.url,
      MCP_AUTH_TOKEN: "secret"
    });

    expect(await rawInitialize(srv.baseUrl, "wrong")).toBe(401);
    expect(srv.stderr()).toMatch(/auth failure \/mcp/);
  });
});

describe("sanitized controller errors", () => {
  it("does not leak controller URL in tool errors", async () => {
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: "http://127.0.0.1:1",
      MCP_AUTH_TOKEN: "secret",
      ANKA_CONTROLLER_START_TIMEOUT_MS: "500"
    });

    const client = await connect(srv.baseUrl, "secret");
    const result = await client.call("controller_list_templates", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain("127.0.0.1:1");
    expect(result.data.error).toMatch(/Could not reach the Anka controller|Controller/);
  });
});
