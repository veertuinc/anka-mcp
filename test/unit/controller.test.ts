import { describe, it, expect, afterEach } from "vitest";
import {
  ControllerClient,
  ControllerError,
  extractSshEndpoint,
  isSshReady,
  type Instance
} from "../../src/controller.js";
import {
  buildAuthorizedKeysStartupScript,
  encodeStartupScript
} from "../../src/ssh-key.js";
import { startMockController, type MockController } from "../helpers/controllerMock.js";

let mock: MockController | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("extractSshEndpoint", () => {
  it("returns connection details for the forwarded SSH port", () => {
    const ssh = extractSshEndpoint({
      host_ip: "10.0.0.5",
      port_forwarding: [{ guest_port: 22, host_port: 10005, name: "ssh" }]
    });
    expect(ssh).toEqual({ host: "10.0.0.5", port: 10005, username: "anka" });
  });

  it("returns undefined without a host IP or matching forward", () => {
    expect(extractSshEndpoint(undefined)).toBeUndefined();
    expect(extractSshEndpoint({ port_forwarding: [{ guest_port: 22, host_port: 1 }] })).toBeUndefined();
    expect(extractSshEndpoint({ host_ip: "10.0.0.5", port_forwarding: [] })).toBeUndefined();
    expect(
      extractSshEndpoint({ host_ip: "10.0.0.5", port_forwarding: [{ guest_port: 80, host_port: 8080 }] })
    ).toBeUndefined();
  });
});

describe("isSshReady", () => {
  const ready: Instance = {
    instance_state: "Started",
    vminfo: { status: "running", host_ip: "10.0.0.5", port_forwarding: [{ guest_port: 22, host_port: 10005 }] }
  };
  it("is true only when started, running, and SSH-reachable", () => {
    expect(isSshReady(ready)).toBe(true);
    expect(isSshReady({ ...ready, instance_state: "Scheduling" })).toBe(false);
    expect(isSshReady({ instance_state: "Started", vminfo: { status: "running" } })).toBe(false);
  });
});

describe("ControllerClient", () => {
  it("lists templates, starts with startup_script, gets, and terminates", async () => {
    mock = await startMockController({ readyAfter: 1 });
    const client = new ControllerClient(mock.url, "");
    const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey anka-mcp";
    const startupScript = encodeStartupScript(buildAuthorizedKeysStartupScript(publicKey));

    const templates = await client.listTemplates();
    expect(templates[0]).toMatchObject({ id: "tmpl-1", name: "14.5-arm64" });

    const id = await client.startVm({ vmid: "tmpl-1", startupScript, addSshPortForward: true });
    expect(id).toBe("inst-1");
    expect(mock.startPayloads[0]).toMatchObject({
      vmid: "tmpl-1",
      count: 1,
      startup_script_condition: 1,
      port_forwarding_override: [{ name: "ssh", guest_port: "22" }]
    });
    const decoded = Buffer.from(String(mock.startPayloads[0].startup_script), "base64").toString("utf8");
    expect(decoded).toContain(publicKey);

    const instance = await client.getVm(id);
    expect(instance.instance_state).toBe("Started");
    expect(extractSshEndpoint(instance.vminfo)).toMatchObject({ host: "10.0.0.5", port: 10005 });

    await client.terminateVm(id);
    expect(mock.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/vm")).toBe(true);
  });

  it("throws ControllerError on transport failure", async () => {
    const client = new ControllerClient("http://127.0.0.1:1/", "");
    await expect(client.listTemplates()).rejects.toBeInstanceOf(ControllerError);
  });
});
