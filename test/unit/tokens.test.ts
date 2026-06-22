import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initTokenStore, resetTokenStoreForTests, LEGACY_CREDENTIAL_ID } from "../../src/tokens/store.js";

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "anka-mcp-tokens-"));
  return join(dir, "test.db");
}

let dbPath = "";

afterEach(() => {
  resetTokenStoreForTests();
  if (dbPath) {
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
    dbPath = "";
  }
});

describe("TokenStore", () => {
  it("creates, validates, lists, and revokes tokens", () => {
    dbPath = tempDbPath();
    const store = initTokenStore(dbPath);

    const created = store.createToken("team-a");
    expect(created.id).toBeTruthy();
    expect(created.label).toBe("team-a");
    expect(created.token).toHaveLength(64);

    expect(store.validateToken(created.token)).toEqual({ id: created.id, label: "team-a" });
    expect(store.validateToken("wrong")).toBeNull();

    const listed = store.listTokens();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.id, label: "team-a", revoked: false, instanceCount: 0 });

    const revoked = store.revokeToken(created.id);
    expect(revoked.instanceIds).toEqual([]);
    expect(store.validateToken(created.token)).toBeNull();
    expect(store.listTokens()[0].revoked).toBe(true);
  });

  it("tracks controller instance ownership per token", () => {
    dbPath = tempDbPath();
    const store = initTokenStore(dbPath);
    store.ensureLegacyCredential();

    const tokenA = store.createToken("a");
    const tokenB = store.createToken("b");

    store.registerInstance(tokenA.id, "inst-1");
    store.registerInstance(tokenB.id, "inst-2");

    expect(() => store.assertInstanceOwned(tokenA.id, "inst-2")).toThrow(/not owned/i);
    store.assertInstanceOwned(tokenA.id, "inst-1");

    store.releaseInstance(tokenA.id, "inst-1");
    expect(() => store.assertInstanceOwned(tokenA.id, "inst-1")).toThrow(/not owned/i);

    store.registerInstance(LEGACY_CREDENTIAL_ID, "legacy-inst");
    store.assertInstanceOwned(LEGACY_CREDENTIAL_ID, "legacy-inst");
  });

  it("returns owned instances on revoke and supports bulk delete", () => {
    dbPath = tempDbPath();
    const store = initTokenStore(dbPath);
    const token = store.createToken();

    store.registerInstance(token.id, "inst-1");
    store.registerInstance(token.id, "inst-2");

    const { instanceIds } = store.revokeToken(token.id);
    expect(instanceIds.sort()).toEqual(["inst-1", "inst-2"]);

    store.deleteInstancesForCredential(token.id);
    expect(store.listInstancesForCredential(token.id)).toEqual([]);
  });

  it("rejects duplicate instance registration", () => {
    dbPath = tempDbPath();
    const store = initTokenStore(dbPath);
    const token = store.createToken();

    store.registerInstance(token.id, "inst-1");
    expect(() => store.registerInstance(token.id, "inst-1")).toThrow();
  });
});
