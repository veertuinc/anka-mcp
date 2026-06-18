import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, connect, FAKE_ANKA, type RunningServer } from "../helpers/mcp.js";

beforeAll(() => {
  chmodSync(FAKE_ANKA, 0o755);
});

let srv: RunningServer | undefined;
afterEach(() => {
  srv?.stop();
  srv = undefined;
});

const baseEnv = (extra: Record<string, string> = {}) => ({
  ANKA_LOCAL: "on",
  ANKA_BIN: FAKE_ANKA,
  MCP_AUTH_TOKEN: "secret",
  ...extra
});

async function start(extra: Record<string, string> = {}) {
  srv = await startServer(baseEnv(extra));
  return connect(srv.baseUrl, "secret");
}

describe("local backend e2e", () => {
  it("exposes only local tools", async () => {
    const client = await start();
    const tools = await client.listTools();
    expect(tools.sort()).toEqual([
      "local_delete_vm",
      "local_list_templates",
      "local_show_vm",
      "local_ssh_access",
      "local_start_vm"
    ]);
  });

  it("lists templates as name + uuid only", async () => {
    const client = await start();
    const res = await client.call("local_list_templates", {});
    expect(res.data.vms).toEqual([
      { name: "base-template", uuid: "uuid-base" },
      { name: "other", uuid: "uuid-other" }
    ]);
  });

  it("shows only the IP", async () => {
    const client = await start({ FAKE_ANKA_RUNNING_VM: "other" });
    const running = await client.call("local_show_vm", { name: "other" });
    expect(running.data).toEqual({ ok: true, ip: "192.168.64.50" });

    const stopped = await client.call("local_show_vm", { name: "base-template" });
    expect(stopped.data).toEqual({ ok: true, ip: null });
  });

  it("rejects flag-like names before running anka", async () => {
    const client = await start();
    const res = await client.call("local_delete_vm", { name: "--all" });
    expect(res.isError).toBe(true);
  });

  it("enforces the running-VM limit on start", async () => {
    const client = await start({ FAKE_ANKA_RUNNING: "2", ANKA_LOCAL_MAX_VMS: "2" });
    const start1 = await client.call("local_start_vm", { template: "base-template" });
    expect(start1.isError).toBe(true);
    expect(start1.data.message).toMatch(/limit of 2/);
  });

  it("clones the template into a new VM, then starts the clone", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "fake-anka-log-")), "calls.log");
    const client = await start({ FAKE_ANKA_RUNNING_VM: "clonevm", FAKE_ANKA_LOG: log });

    const res = await client.call("local_start_vm", { template: "base-template", name: "clonevm" });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      ok: true,
      name: "clonevm",
      source: "base-template",
      ip: "192.168.64.50"
    });

    const calls = readFileSync(log, "utf8");
    expect(calls).toMatch(/"clone","base-template","clonevm"/);
    expect(calls).toMatch(/"start","clonevm"/);
    // The original template must never be started directly.
    expect(calls).not.toMatch(/"start","base-template"/);
  });

  it("auto-generates a clone name when none is given", async () => {
    const client = await start();
    const res = await client.call("local_start_vm", { template: "base-template", wait: false });
    expect(res.isError).toBe(false);
    expect(res.data.source).toBe("base-template");
    expect(res.data.name).toMatch(/^mcp-/);
  });

  it("start waits for the IP and returns it", async () => {
    const counter = join(mkdtempSync(join(tmpdir(), "fake-anka-count-")), "count");
    const client = await start({
      FAKE_ANKA_RUNNING_VM: "boot",
      FAKE_ANKA_IP_AFTER: "2",
      FAKE_ANKA_COUNT_FILE: counter,
      ANKA_LOCAL_POLL_INTERVAL_MS: "20"
    });
    const res = await client.call("local_start_vm", { template: "base-template", name: "boot" });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ ok: true, name: "boot", source: "base-template", ip: "192.168.64.50" });
  });

  it("start can skip waiting with wait=false", async () => {
    const client = await start({ FAKE_ANKA_RUNNING_VM: "boot" });
    const res = await client.call("local_start_vm", { template: "base-template", name: "boot", wait: false });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ ok: true, name: "boot", source: "base-template" });
  });

  it("start reports a timeout when no IP appears", async () => {
    const client = await start({
      ANKA_LOCAL_IP_TIMEOUT_MS: "150",
      ANKA_LOCAL_POLL_INTERVAL_MS: "30"
    });
    const res = await client.call("local_start_vm", { template: "base-template", name: "neverup" });
    expect(res.isError).toBe(true);
    expect(res.data.error).toMatch(/timed out/i);
  });

  it("ssh access waits for a pending IP", async () => {
    const counter = join(mkdtempSync(join(tmpdir(), "fake-anka-count-")), "count");
    const client = await start({
      FAKE_ANKA_RUNNING_VM: "sshvm",
      FAKE_ANKA_IP_AFTER: "2",
      FAKE_ANKA_COUNT_FILE: counter,
      ANKA_LOCAL_POLL_INTERVAL_MS: "20"
    });
    const res = await client.call("local_ssh_access", { name: "sshvm" });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ ok: true, ip: "192.168.64.50" });
  });

  it("provisions SSH access by installing a temporary key", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "fake-anka-log-")), "calls.log");
    const client = await start({ FAKE_ANKA_RUNNING_VM: "sshvm", FAKE_ANKA_LOG: log });

    const res = await client.call("local_ssh_access", { name: "sshvm" });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ ok: true, ip: "192.168.64.50", port: 22, user: "anka" });
    expect(res.data.private_key_path).toContain("id_ed25519");
    expect(res.data.command).toMatch(/^ssh -i .* anka@192\.168\.64\.50$/);

    const calls = readFileSync(log, "utf8");
    expect(calls).toMatch(/"cp"/);
    expect(calls).toMatch(/"run"/);
  });

  it("refuses SSH access for a VM that is not running", async () => {
    const client = await start();
    const res = await client.call("local_ssh_access", { name: "base-template" });
    expect(res.isError).toBe(true);
    expect(res.data.error).toMatch(/not running/i);
  });
});
