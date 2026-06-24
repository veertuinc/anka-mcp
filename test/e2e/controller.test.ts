import { describe, it, expect, afterEach } from "vitest";
import { startServer, connect, type RunningServer } from "../helpers/mcp.js";
import { startMockController, type MockController } from "../helpers/controllerMock.js";
import { TEST_PUBLIC_KEY_BASE64, TEST_PUBLIC_KEY_LINE } from "../helpers/ssh-fixtures.js";
import { SSH_KEY_CLEANUP_INSTRUCTIONS } from "../../src/ssh-key.js";

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

  it("returns SSH key instructions when ssh_public_key_base64 is omitted", async () => {
    const client = await startWith({ readyAfter: 1 });
    const res = await client.call("controller_request_vm", { vmid: "tmpl-1" });
    expect(res.isError).toBe(true);
    expect(res.data.error).toMatch(/ssh_public_key_base64 is required/i);
    expect(res.data.ssh_key_instructions).toMatch(/ssh-keygen -t ed25519/i);
    expect(mock!.startPayloads).toHaveLength(0);
  });

  it("requests a VM and returns SSH endpoint details", async () => {
    const client = await startWith({ readyAfter: 2 });
    const res = await client.call("controller_request_vm", {
      vmid: "tmpl-1",
      ssh_public_key_base64: TEST_PUBLIC_KEY_BASE64
    });
    expect(res.isError).toBe(false);
    expect(res.data).not.toHaveProperty("vminfo");
    expect(res.data.instance_id).toBe("inst-1");
    expect(res.data.status).toBe("ready");
    expect(res.data.ssh).toEqual({
      host: "10.0.0.5",
      port: 10005,
      username: "anka"
    });
    expect(res.data.ssh_connect_hint).toMatch(/Wait ~20 seconds/i);
    expect(res.data.ssh).not.toHaveProperty("private_key");
    expect(mock!.startPayloads[0].startup_script).toBeTruthy();
    expect(mock!.startPayloads[0].startup_script_condition).toBe(1);
    const script = Buffer.from(String(mock!.startPayloads[0].startup_script), "base64").toString("utf8");
    expect(script).toContain(TEST_PUBLIC_KEY_LINE);
    expect(script).toContain("authorized_keys");
    expect(String(mock!.startPayloads[0].external_id)).toContain("anka-mcp");
  });

  it("reports a terminal state as an error", async () => {
    const client = await startWith({ failWithState: "Error" });
    const res = await client.call("controller_request_vm", {
      vmid: "tmpl-1",
      ssh_public_key_base64: TEST_PUBLIC_KEY_BASE64
    });
    expect(res.isError).toBe(true);
    expect(res.data.error).toMatch(/terminal state/i);
  });

  it("returns pending status while a template is pulling", async () => {
    const client = await startWith({ readyAfter: 100, pendingState: "Pulling" });
    const res = await client.call("controller_request_vm", {
      vmid: "tmpl-1",
      ssh_public_key_base64: TEST_PUBLIC_KEY_BASE64
    });
    expect(res.isError).toBe(false);
    expect(res.data.instance_id).toBe("inst-1");
    expect(res.data.instance_state).toBe("Pulling");
    expect(res.data.vm_status).toBe("pulling");
    expect(res.data.ssh).toBeNull();
    expect(res.data.status).toBe("pending");
    expect(res.data.message).toMatch(/being pulled/i);
  });

  it("returns pending guidance from controller_get_vm while pulling", async () => {
    const client = await startWith({ fixedState: "Pulling" });
    await client.call("controller_request_vm", {
      vmid: "tmpl-1",
      ssh_public_key_base64: TEST_PUBLIC_KEY_BASE64
    });
    const res = await client.call("controller_get_vm", { instance_id: "inst-1" });
    expect(res.isError).toBe(false);
    expect(res.data.instance_state).toBe("Pulling");
    expect(res.data.status).toBe("pending");
    expect(res.data.ssh).toBeNull();
  });

  it("returns SSH endpoint from controller_get_vm after pending provisioning", async () => {
    const client = await startWith({ readyAfter: 2, pendingState: "Pulling" });
    const request = await client.call("controller_request_vm", {
      vmid: "tmpl-1",
      ssh_public_key_base64: TEST_PUBLIC_KEY_BASE64
    });
    expect(request.data.status).toBe("pending");

    const ready = await client.call("controller_get_vm", { instance_id: "inst-1" });
    expect(ready.isError).toBe(false);
    expect(ready.data.status).toBe("ready");
    expect(ready.data.ssh).toEqual({ host: "10.0.0.5", port: 10005, username: "anka" });
    expect(ready.data.ssh_connect_hint).toMatch(/IdentitiesOnly/i);
  });

  it("terminates an instance owned by the caller", async () => {
    const client = await startWith({ readyAfter: 1 });
    await client.call("controller_request_vm", {
      vmid: "tmpl-1",
      ssh_public_key_base64: TEST_PUBLIC_KEY_BASE64
    });
    const res = await client.call("controller_terminate_vm", { instance_id: "inst-1" });
    expect(res.data).toEqual({
      instance_id: "inst-1",
      terminated: true,
      ssh_key_cleanup: SSH_KEY_CLEANUP_INSTRUCTIONS
    });
  });
});
