import { describe, it, expect } from "vitest";
import { getPackageVersion } from "../../src/version.js";

describe("getPackageVersion", () => {
  it("returns a semver-like version string", () => {
    expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
