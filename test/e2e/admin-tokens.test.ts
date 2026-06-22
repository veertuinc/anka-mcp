import { afterEach, describe, expect, it } from "vitest";
import { startMockController, type MockController } from "../helpers/controllerMock.js";
import {
  adminClient,
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

async function startAdminServer(extraEnv: Record<string, string> = {}) {
  mock = await startMockController({ readyAfter: 1 });
  srv = await startServer({
    ANKA_LOCAL: "off",
    MCP_ADMIN_TOKEN: "admin-secret",
    ANKA_CONTROLLER_URL: mock.url,
    ANKA_CONTROLLER_POLL_INTERVAL_MS: "50",
    ANKA_CONTROLLER_START_TIMEOUT_MS: "5000",
    ANKA_CONTROLLER_SSH_PROBE: "0",
    ...extraEnv
  });
  return { admin: adminClient(srv.baseUrl, "admin-secret"), baseUrl: srv.baseUrl, mock };
}

describe("admin token API", () => {
  it("requires admin authentication", async () => {
    const { baseUrl } = await startAdminServer();
    const res = await fetch(`${baseUrl}/admin/tokens`);
    expect(res.status).toBe(401);
  });

  it("creates a client token and allows MCP access", async () => {
    const { admin, baseUrl } = await startAdminServer();
    const created = await admin.createToken("team-a");
    expect(created.status).toBe(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.token).toHaveLength(64);

    expect(await rawInitialize(baseUrl)).toBe(401);
    expect(await rawInitialize(baseUrl, created.body.token)).toBe(200);

    const listed = await admin.listTokens();
    expect(listed.body.tokens).toHaveLength(1);
    expect(listed.body.tokens[0]).toMatchObject({ label: "team-a", revoked: false, instanceCount: 0 });
  });

  it("revokes a token, blocks MCP access, and terminates owned controller VMs", async () => {
    const { admin, baseUrl, mock } = await startAdminServer();
    const created = await admin.createToken("team-a");
    const client = await connect(baseUrl, created.body.token);

    const started = await client.call("controller_request_vm", { vmid: "tmpl-1" });
    expect(started.isError).toBe(false);
    expect(started.data.instance_id).toBe("inst-1");

    const revoked = await admin.revokeToken(created.body.id);
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({
      ok: true,
      revoked: true,
      cleanup: { terminated: ["inst-1"], failed: [] }
    });
    expect(mock!.terminatedIds).toEqual(["inst-1"]);
    expect(await rawInitialize(baseUrl, created.body.token)).toBe(401);
  });

  it("skips controller cleanup when MCP_REVOKE_CLEANUP is off", async () => {
    const { admin, baseUrl, mock } = await startAdminServer({ MCP_REVOKE_CLEANUP: "off" });
    const created = await admin.createToken();
    const client = await connect(baseUrl, created.body.token);
    await client.call("controller_request_vm", { vmid: "tmpl-1" });

    const revoked = await admin.revokeToken(created.body.id);
    expect(revoked.body.cleanup).toEqual({ terminated: [], failed: [] });
    expect(mock!.terminatedIds).toEqual([]);
  });
});
