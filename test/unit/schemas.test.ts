import { describe, expect, it } from "vitest";
import {
  boundedName,
  optionalBoundedString,
  timeoutSecondsSchema,
  uuidLike
} from "../../src/security/schemas.js";

describe("boundedName", () => {
  it("accepts valid names and rejects flag-like values", () => {
    expect(boundedName.parse("my-vm")).toBe("my-vm");
    expect(() => boundedName.parse("-all")).toThrow();
    expect(() => boundedName.parse("")).toThrow();
    expect(() => boundedName.parse("x".repeat(129))).toThrow();
  });
});

describe("uuidLike", () => {
  it("accepts opaque ids and rejects unsafe characters", () => {
    expect(uuidLike.parse("tmpl-1")).toBe("tmpl-1");
    expect(() => uuidLike.parse("id with spaces")).toThrow();
    expect(() => uuidLike.parse("x".repeat(65))).toThrow();
  });
});

describe("optionalBoundedString", () => {
  it("caps length at 512", () => {
    expect(() => optionalBoundedString.parse("a".repeat(513))).toThrow();
  });
});

describe("timeoutSecondsSchema", () => {
  it("caps wait time at one hour", () => {
    expect(timeoutSecondsSchema.parse(60)).toBe(60);
    expect(() => timeoutSecondsSchema.parse(3601)).toThrow();
  });
});
