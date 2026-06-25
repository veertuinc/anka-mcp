import { afterEach, describe, expect, it } from "vitest";
import { startMockController, type MockController } from "../helpers/controllerMock.js";
import {
  connect,
  createClientToken,
  rawInitialize,
  startServer,
  TEST_ADMIN_TOKEN,
  type RunningServer
} from "../helpers/mcp.js";

let srv: RunningServer | undefined;
let mock: MockController | undefined;
let clientToken: string | undefined;

afterEach(() => {
  srv?.stop();
  srv = undefined;
  void mock?.close();
  mock = undefined;
  clientToken = undefined;
});

async function startWithClientToken(extra: Record<string, string> = {}) {
  mock = await startMockController();
  srv = await startServer({
    ANKA_LOCAL: "off",
    ANKA_CONTROLLER_URL: mock.url,
    ANKA_MCP_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    ...extra
  });
  clientToken = await createClientToken(srv.baseUrl, TEST_ADMIN_TOKEN);
  return clientToken;
}

describe("origin guard", () => {
  it("rejects disallowed Origin headers", async () => {
    const token = await startWithClientToken({
      ANKA_MCP_ALLOWED_ORIGINS: "https://allowed.example"
    });

    const res = await fetch(`${srv!.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
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
    expect(srv!.stderr()).toMatch(/LIMIT REACHED ANKA_MCP_ALLOWED_ORIGINS=/);
    expect(srv!.stderr()).toMatch(/origin=https:\/\/evil\.example/);
  });
});

describe("rate limiting", () => {
  it("returns 429 after exceeding ANKA_MCP_RATE_LIMIT_RPM", async () => {
    mock = await startMockController();
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: mock.url,
      ANKA_MCP_ALLOW_NO_AUTH: "1",
      ANKA_MCP_RATE_LIMIT_RPM: "2"
    });

    expect(await rawInitialize(srv!.baseUrl)).toBe(200);
    expect(await rawInitialize(srv!.baseUrl)).toBe(200);
    expect(await rawInitialize(srv!.baseUrl)).toBe(429);
    expect(srv!.stderr()).toMatch(/LIMIT REACHED ANKA_MCP_RATE_LIMIT_RPM=2 by source=/);
    expect(srv!.stderr()).toMatch(/requests_in_window=2/);
    expect(srv!.stderr()).toMatch(/route=\/mcp/);
  });
});

describe("request body limit", () => {
  it("rejects oversized JSON bodies", async () => {
    const token = await startWithClientToken({ ANKA_MCP_MAX_BODY_BYTES: "256" });

    const res = await fetch(`${srv!.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`
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
    expect(srv!.stderr()).toMatch(/LIMIT REACHED ANKA_MCP_MAX_BODY_BYTES=256 by source=/);
    expect(srv!.stderr()).toMatch(/body_too_large/);
  });
});

describe("max concurrent sessions", () => {
  it("returns 503 and logs when ANKA_MCP_MAX_SESSIONS is reached", async () => {
    const token = await startWithClientToken({ ANKA_MCP_MAX_SESSIONS: "1" });

    expect(await rawInitialize(srv!.baseUrl, token)).toBe(200);
    expect(await rawInitialize(srv!.baseUrl, token)).toBe(503);
    expect(srv!.stderr()).toMatch(/LIMIT REACHED ANKA_MCP_MAX_SESSIONS=1 by source=/);
    expect(srv!.stderr()).toMatch(/active_sessions=1/);
    expect(srv!.stderr()).toMatch(/route=\/mcp/);
  });
});

describe("auth failure logging", () => {
  it("logs auth failures to stderr", async () => {
    await startWithClientToken();

    expect(await rawInitialize(srv!.baseUrl, "wrong")).toBe(401);
    expect(srv!.stderr()).toMatch(/auth failure \/mcp/);
  });
});

describe("sanitized controller errors", () => {
  it("does not leak controller URL in tool errors", async () => {
    srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: "http://127.0.0.1:1",
      ANKA_MCP_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
      ANKA_CONTROLLER_START_TIMEOUT_MS: "500"
    });
    const token = await createClientToken(srv.baseUrl, TEST_ADMIN_TOKEN);

    const client = await connect(srv.baseUrl, token);
    const result = await client.call("controller_list_templates", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain("127.0.0.1:1");
    expect(result.data.error).toMatch(/Could not reach the Anka controller|Controller/);
  });
});
