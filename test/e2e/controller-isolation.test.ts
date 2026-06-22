import { afterEach, describe, expect, it } from "vitest";
import { startMockController, type MockController } from "../helpers/controllerMock.js";
import {
  adminClient,
  connect,
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

describe("controller VM isolation per token", () => {
  it("denies get/terminate on instances owned by another token", async () => {
    mock = await startMockController({ readyAfter: 1 });
    srv = await startServer({
      ANKA_LOCAL: "off",
      MCP_ADMIN_TOKEN: "admin-secret",
      ANKA_CONTROLLER_URL: mock.url,
      ANKA_CONTROLLER_POLL_INTERVAL_MS: "50",
      ANKA_CONTROLLER_START_TIMEOUT_MS: "5000",
      ANKA_CONTROLLER_SSH_PROBE: "0"
    });

    const admin = adminClient(srv.baseUrl, "admin-secret");
    const tokenA = await admin.createToken("a");
    const tokenB = await admin.createToken("b");

    const clientA = await connect(srv.baseUrl, tokenA.body.token);
    const clientB = await connect(srv.baseUrl, tokenB.body.token);

    const started = await clientA.call("controller_request_vm", { vmid: "tmpl-1" });
    expect(started.isError).toBe(false);
    expect(started.data.instance_id).toBe("inst-1");

    const getDenied = await clientB.call("controller_get_vm", { instance_id: "inst-1" });
    expect(getDenied.isError).toBe(true);
    expect(getDenied.data.error).toMatch(/not owned/i);

    const terminateDenied = await clientB.call("controller_terminate_vm", { instance_id: "inst-1" });
    expect(terminateDenied.isError).toBe(true);
    expect(terminateDenied.data.error).toMatch(/not owned/i);

    const terminateOk = await clientA.call("controller_terminate_vm", { instance_id: "inst-1" });
    expect(terminateOk.data).toEqual({ instance_id: "inst-1", terminated: true });
  });
});
