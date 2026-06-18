import { describe, it, expect, afterEach } from "vitest";
import { startServer, connect, type RunningServer } from "../helpers/mcp.js";
import { startMockController, type MockController } from "../helpers/controllerMock.js";

let srv: RunningServer | undefined;
let mock: MockController | undefined;

afterEach(async () => {
  srv?.stop();
  srv = undefined;
  await mock?.close();
  mock = undefined;
});

async function startWith(mockOpts: Parameters<typeof startMockController>[0]) {
  mock = await startMockController(mockOpts);
  srv = await startServer({
    ANKA_LOCAL: "off",
    MCP_AUTH_TOKEN: "secret",
    ANKA_CONTROLLER_URL: mock.url,
    ANKA_CONTROLLER_POLL_INTERVAL_MS: "50",
    ANKA_CONTROLLER_START_TIMEOUT_MS: "5000"
  });
  return connect(srv.baseUrl, "secret");
}

describe("controller backend e2e", () => {
  it("exposes only controller tools", async () => {
    const client = await startWith({ readyAfter: 1 });
    const tools = await client.listTools();
    expect(tools.sort()).toEqual([
      "controller_get_vm",
      "controller_list_templates",
      "controller_request_vm",
      "controller_terminate_vm"
    ]);
  });

  it("lists templates with a trimmed shape", async () => {
    const client = await startWith({ readyAfter: 1 });
    const res = await client.call("controller_list_templates", {});
    expect(res.data.templates).toEqual([{ id: "tmpl-1", name: "14.5-arm64", arch: "arm64" }]);
  });

  it("requests a VM and returns only SSH connection details", async () => {
    const client = await startWith({ readyAfter: 2 });
    const res = await client.call("controller_request_vm", { vmid: "tmpl-1" });
    expect(res.isError).toBe(false);
    expect(res.data).not.toHaveProperty("vminfo");
    expect(res.data.instance_id).toBe("inst-1");
    expect(res.data.ssh).toEqual({
      host: "10.0.0.5",
      port: 10005,
      username: "anka",
      password: "admin"
    });
  });

  it("reports a terminal state as an error", async () => {
    const client = await startWith({ failWithState: "Error" });
    const res = await client.call("controller_request_vm", { vmid: "tmpl-1" });
    expect(res.isError).toBe(true);
    expect(res.data.error).toMatch(/terminal state/i);
  });

  it("terminates an instance", async () => {
    const client = await startWith({ readyAfter: 1 });
    const res = await client.call("controller_terminate_vm", { instance_id: "inst-1" });
    expect(res.data).toEqual({ instance_id: "inst-1", terminated: true });
  });
});
