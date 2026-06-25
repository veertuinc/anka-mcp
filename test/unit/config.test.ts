import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config.js";

const base = { ANKA_LOCAL: "off" } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("applies sane defaults", () => {
    const c = loadConfig(base);
    expect(c.httpPort).toBe(9111);
    expect(c.httpHost).toBe("127.0.0.1");
    expect(c.maxBodyBytes).toBe(1_048_576);
    expect(c.rateLimitRpm).toBe(120);
    expect(c.sessionIdleMs).toBe(3_600_000);
    expect(c.maxSessions).toBe(50);
    expect(c.maxResponseChars).toBe(32_768);
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

  it("defaults local to off when a controller URL is configured", () => {
    const env = { ANKA_CONTROLLER_URL: "http://ctl:8090" } as NodeJS.ProcessEnv;
    expect(loadConfig(env).localEnabled).toBe(false);
    expect(loadConfig({ ...env, ANKA_LOCAL: "on" }).localEnabled).toBe(true);
    expect(loadConfig({ ...env, ANKA_LOCAL: "auto" }).localEnabled).toBe(
      loadConfig({ ANKA_LOCAL: "auto" }).localEnabled
    );
  });

  it("allows a zero VM limit but rejects negatives", () => {
    expect(loadConfig({ ...base, ANKA_LOCAL_MAX_VMS: "0" }).localMaxVms).toBe(0);
    expect(loadConfig({ ...base, ANKA_LOCAL_MAX_VMS: "5" }).localMaxVms).toBe(5);
    expect(loadConfig({ ...base, ANKA_LOCAL_MAX_VMS: "-3" }).localMaxVms).toBe(2);
  });

  it("parses admin and database settings", () => {
    const c = loadConfig({
      ...base,
      ANKA_MCP_ADMIN_TOKEN: " admin ",
      ANKA_MCP_DB_PATH: " /tmp/test.db ",
      ANKA_MCP_REVOKE_CLEANUP: "off",
      ANKA_MCP_ALLOW_NO_AUTH: "1",
      ANKA_MCP_ALLOWED_ORIGINS: "https://a.com, https://b.com"
    });
    expect(c.adminToken).toBe("admin");
    expect(c.dbPath).toBe("/tmp/test.db");
    expect(c.revokeCleanupEnabled).toBe(false);
    expect(c.allowNoAuth).toBe(true);
    expect(c.allowedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("enables logging by default and allows disabling it", () => {
    expect(loadConfig(base).logEnabled).toBe(true);
    expect(loadConfig({ ...base, ANKA_MCP_LOG: "off" }).logEnabled).toBe(false);
  });

  it("honors overridden VM SSH defaults and guest port", () => {
    const c = loadConfig({ ...base, ANKA_VM_SSH_USER: "dev", ANKA_VM_SSH_GUEST_PORT: "2222" });
    expect(c.vmSshUser).toBe("dev");
    expect(c.vmSshGuestPort).toBe(2222);
  });
});
