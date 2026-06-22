import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

const base = { ANKA_LOCAL: "off" } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("applies sane defaults", () => {
    const c = loadConfig(base);
    expect(c.httpPort).toBe(9111);
    expect(c.httpHost).toBe("0.0.0.0");
    expect(c.ankaBin).toBe("anka");
    expect(c.localMaxVms).toBe(2);
    expect(c.vmSshUser).toBe("anka");
    expect(c.vmSshPassword).toBe("admin");
    expect(c.vmSshGuestPort).toBe(22);
    expect(c.controllerEnabled).toBe(false);
  });

  it("enables the controller backend and strips a trailing slash from the URL", () => {
    const c = loadConfig({ ...base, ANKA_CONTROLLER_URL: "http://ctl:8090/" });
    expect(c.controllerEnabled).toBe(true);
    expect(c.controllerUrl).toBe("http://ctl:8090");
  });

  it("resolves the local backend from ANKA_LOCAL", () => {
    expect(loadConfig({ ANKA_LOCAL: "on" }).localEnabled).toBe(true);
    expect(loadConfig({ ANKA_LOCAL: "off" }).localEnabled).toBe(false);
  });

  it("allows a zero VM limit but rejects negatives", () => {
    expect(loadConfig({ ...base, ANKA_LOCAL_MAX_VMS: "0" }).localMaxVms).toBe(0);
    expect(loadConfig({ ...base, ANKA_LOCAL_MAX_VMS: "5" }).localMaxVms).toBe(5);
    expect(loadConfig({ ...base, ANKA_LOCAL_MAX_VMS: "-3" }).localMaxVms).toBe(2);
  });

  it("parses auth and origin settings", () => {
    const c = loadConfig({
      ...base,
      MCP_AUTH_TOKEN: "  secret  ",
      MCP_ALLOW_NO_AUTH: "1",
      MCP_ALLOWED_ORIGINS: "https://a.com, https://b.com"
    });
    expect(c.authToken).toBe("secret");
    expect(c.allowNoAuth).toBe(true);
    expect(c.allowedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("honors overridden VM SSH defaults and guest port", () => {
    const c = loadConfig({ ...base, ANKA_VM_SSH_USER: "dev", ANKA_VM_SSH_GUEST_PORT: "2222" });
    expect(c.vmSshUser).toBe("dev");
    expect(c.vmSshGuestPort).toBe(2222);
  });
});
