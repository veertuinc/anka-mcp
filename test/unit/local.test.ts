import { describe, it, expect } from "vitest";
import type { AnkaResult } from "../../src/anka.js";
import { ankaError, localResult, vmNameSchema } from "../../src/tools/local/vms.js";

function result(overrides: Partial<AnkaResult>): AnkaResult {
  return {
    ok: true,
    exitCode: 0,
    args: [],
    stdout: "",
    stderr: "",
    ...overrides
  };
}

describe("vmNameSchema", () => {
  it("accepts normal names and trims whitespace", () => {
    expect(vmNameSchema.parse("  my-vm  ")).toBe("my-vm");
  });

  it("rejects empty names and flag-like names", () => {
    expect(vmNameSchema.safeParse("").success).toBe(false);
    expect(vmNameSchema.safeParse("--all").success).toBe(false);
    expect(vmNameSchema.safeParse("-x").success).toBe(false);
  });
});

describe("ankaError", () => {
  it("prefers message, then stderr, then exit code", () => {
    expect(ankaError(result({ ok: false, message: "boom" }))).toBe("boom");
    expect(ankaError(result({ ok: false, stderr: " bad \n" }))).toBe("bad");
    expect(ankaError(result({ ok: false, exitCode: 7 }))).toBe("anka exited with code 7");
  });
});

describe("localResult", () => {
  it("returns a clean success payload", () => {
    const r = localResult(result({ ok: true }), { name: "vm1" });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ ok: true, name: "vm1" });
  });

  it("returns a clean error payload on failure", () => {
    const r = localResult(result({ ok: false, message: "nope" }), { name: "vm1" });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ ok: false, error: "nope" });
  });
});
