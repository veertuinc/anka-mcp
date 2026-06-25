import { describe, it, expect } from "vitest";
import {
  startServer,
  expectStartFailure,
  rawInitialize,
  tempDbPath,
  createClientToken,
  TEST_ADMIN_TOKEN
} from "../helpers/mcp.js";

const DUMMY_CONTROLLER = "http://127.0.0.1:9";

describe("startup guards", () => {
  it("refuses to start without authentication", async () => {
    const err = await expectStartFailure({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      ANKA_MCP_DB_PATH: tempDbPath()
    });
    expect(err).toMatch(/authentication/i);
    expect(err).toMatch(/ANKA_MCP_ADMIN_TOKEN/i);
  });

  it("refuses to start with no backend enabled", async () => {
    const err = await expectStartFailure({
      ANKA_LOCAL: "off",
      ANKA_MCP_ADMIN_TOKEN: TEST_ADMIN_TOKEN
    });
    expect(err).toMatch(/no backend enabled/i);
  });
});

describe("bearer-token auth", () => {
  it("allows startup with ANKA_MCP_ADMIN_TOKEN only", async () => {
    const srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      ANKA_MCP_ADMIN_TOKEN: TEST_ADMIN_TOKEN
    });
    try {
      expect(await rawInitialize(srv.baseUrl)).toBe(401);
    } finally {
      srv.stop();
    }
  });

  it("rejects missing/wrong tokens and accepts a client token", async () => {
    const srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      ANKA_MCP_ADMIN_TOKEN: TEST_ADMIN_TOKEN
    });
    try {
      const clientToken = await createClientToken(srv.baseUrl, TEST_ADMIN_TOKEN);
      expect(await rawInitialize(srv.baseUrl)).toBe(401);
      expect(await rawInitialize(srv.baseUrl, "nope")).toBe(401);
      expect(await rawInitialize(srv.baseUrl, clientToken)).toBe(200);
    } finally {
      srv.stop();
    }
  });

  it("allows unauthenticated access when explicitly opted in", async () => {
    const srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      ANKA_MCP_ALLOW_NO_AUTH: "1"
    });
    try {
      expect(await rawInitialize(srv.baseUrl)).toBe(200);
    } finally {
      srv.stop();
    }
  });
});
