import { describe, it, expect, afterEach } from "vitest";
import {
  ControllerClient,
  ControllerError,
  extractSsh,
  isSshReady,
  type Instance
} from "../../src/controller.js";
import { startMockController, type MockController } from "../helpers/controllerMock.js";

let mock: MockController | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("extractSsh", () => {
  it("returns connection details for the forwarded SSH port", () => {
    const ssh = extractSsh({
      host_ip: "10.0.0.5",
      port_forwarding: [{ guest_port: 22, host_port: 10005, name: "ssh" }]
    });
    expect(ssh).toEqual({ host: "10.0.0.5", port: 10005, username: "anka", password: "admin" });
  });

  it("returns undefined without a host IP or matching forward", () => {
    expect(extractSsh(undefined)).toBeUndefined();
    expect(extractSsh({ port_forwarding: [{ guest_port: 22, host_port: 1 }] })).toBeUndefined();
    expect(extractSsh({ host_ip: "10.0.0.5", port_forwarding: [] })).toBeUndefined();
    expect(
      extractSsh({ host_ip: "10.0.0.5", port_forwarding: [{ guest_port: 80, host_port: 8080 }] })
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
  it("lists templates, starts, gets, and terminates", async () => {
    mock = await startMockController({ readyAfter: 1 });
    const client = new ControllerClient(mock.url, "");

    const templates = await client.listTemplates();
    expect(templates[0]).toMatchObject({ id: "tmpl-1", name: "14.5-arm64" });

    const id = await client.startVm({ vmid: "tmpl-1" });
    expect(id).toBe("inst-1");

    const instance = await client.getVm(id);
    expect(instance.instance_state).toBe("Started");
    expect(extractSsh(instance.vminfo)).toMatchObject({ host: "10.0.0.5", port: 10005 });

    await client.terminateVm(id);
    expect(mock.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/vm")).toBe(true);
  });

  it("throws ControllerError on transport failure", async () => {
    const client = new ControllerClient("http://127.0.0.1:1/", "");
    await expect(client.listTemplates()).rejects.toBeInstanceOf(ControllerError);
  });
});
