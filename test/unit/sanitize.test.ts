import { describe, expect, it } from "vitest";
import { sanitizeCliError, sanitizeControllerError } from "../../src/security/sanitize.js";

describe("sanitizeControllerError", () => {
  it("strips controller URLs from reachability errors", () => {
    expect(
      sanitizeControllerError("Failed to reach controller at http://secret.internal:8090: ECONNREFUSED")
    ).toBe("Could not reach the Anka controller");
  });

  it("maps HTTP failures to safe messages", () => {
    expect(
      sanitizeControllerError('Controller request failed (POST /api/v1/vm): {"secret":"payload"} HTTP 403')
    ).toBe("Controller rejected the request (HTTP 403)");
  });

  it("returns a generic fallback for unknown messages", () => {
    expect(sanitizeControllerError("something else")).toBe("Controller operation failed");
  });
});

describe("sanitizeCliError", () => {
  it("strips file paths and caps length", () => {
    const longPath = `/Users/secret/long/path/${"x".repeat(300)}`;
    const result = sanitizeCliError(`failed at ${longPath}`);
    expect(result).not.toContain("/Users/secret");
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
