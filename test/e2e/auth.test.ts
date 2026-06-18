import { describe, it, expect } from "vitest";
import { startServer, expectStartFailure, rawInitialize } from "../helpers/mcp.js";

const DUMMY_CONTROLLER = "http://127.0.0.1:9";

describe("startup guards", () => {
  it("refuses to start without authentication", async () => {
    const err = await expectStartFailure({ ANKA_LOCAL: "off", ANKA_CONTROLLER_URL: DUMMY_CONTROLLER });
    expect(err).toMatch(/authentication/i);
  });

  it("refuses to start with no backend enabled", async () => {
    const err = await expectStartFailure({ ANKA_LOCAL: "off", MCP_AUTH_TOKEN: "secret" });
    expect(err).toMatch(/no backend enabled/i);
  });
});

describe("bearer-token auth", () => {
  it("rejects missing/wrong tokens and accepts the right one", async () => {
    const srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      MCP_AUTH_TOKEN: "secret"
    });
    try {
      expect(await rawInitialize(srv.baseUrl)).toBe(401);
      expect(await rawInitialize(srv.baseUrl, "nope")).toBe(401);
      expect(await rawInitialize(srv.baseUrl, "secret")).toBe(200);
    } finally {
      srv.stop();
    }
  });

  it("allows unauthenticated access when explicitly opted in", async () => {
    const srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      MCP_ALLOW_NO_AUTH: "1"
    });
    try {
      expect(await rawInitialize(srv.baseUrl)).toBe(200);
    } finally {
      srv.stop();
    }
  });
});
