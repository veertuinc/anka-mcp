import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { startServer } from "../helpers/mcp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(HERE, "../../package.json"), "utf8")
).version as string;

const DUMMY_CONTROLLER = "http://127.0.0.1:9";

describe("status endpoint", () => {
  it("returns the package version without authentication", async () => {
    const srv = await startServer({
      ANKA_LOCAL: "off",
      ANKA_CONTROLLER_URL: DUMMY_CONTROLLER,
      MCP_AUTH_TOKEN: "secret"
    });
    try {
      const res = await fetch(`${srv.baseUrl}/status`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ version: PACKAGE_VERSION });
    } finally {
      srv.stop();
    }
  });
});
