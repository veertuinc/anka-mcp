import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { migrateSchema } from "./schema.js";

export const LEGACY_CREDENTIAL_ID = "legacy";

export interface TokenRecord {
  id: string;
  label: string;
  createdAt: string;
  revoked: boolean;
  instanceCount: number;
}

export interface ValidatedToken {
  id: string;
  label: string;
}

export interface RevokeResult {
  instanceIds: string[];
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export class TokenStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    migrateSchema(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** Ensure a synthetic row exists for the legacy env bearer (FK target for instances). */
  ensureLegacyCredential(): void {
    this.db
      .prepare(
        `INSERT INTO tokens (id, label, token_hash, created_at, revoked_at)
         VALUES (?, '', '__legacy__', ?, NULL)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(LEGACY_CREDENTIAL_ID, nowIso());
  }

  hasActiveTokens(): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tokens WHERE revoked_at IS NULL AND token_hash != '__legacy__'`)
      .get() as { count: number };
    return row.count > 0;
  }

  createToken(label = ""): { id: string; label: string; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString("hex");
    const createdAt = nowIso();
    const trimmedLabel = label.trim();

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tokens (id, label, token_hash, created_at, revoked_at)
           VALUES (?, ?, ?, ?, NULL)`
        )
        .run(id, trimmedLabel, hashToken(token), createdAt);
    });
    insert();

    return { id, label: trimmedLabel, token };
  }

  listTokens(): TokenRecord[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.label, t.created_at, t.revoked_at,
                COUNT(i.instance_id) AS instance_count
         FROM tokens t
         LEFT JOIN instances i ON i.credential_id = t.id
         WHERE t.token_hash != '__legacy__'
         GROUP BY t.id
         ORDER BY t.created_at ASC`
      )
      .all() as {
      id: string;
      label: string;
      created_at: string;
      revoked_at: string | null;
      instance_count: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      revoked: row.revoked_at !== null,
      instanceCount: row.instance_count
    }));
  }

  getTokenById(id: string): { id: string; label: string; revoked: boolean } | null {
    const row = this.db
      .prepare(`SELECT id, label, revoked_at FROM tokens WHERE id = ? AND token_hash != '__legacy__'`)
      .get(id) as { id: string; label: string; revoked_at: string | null } | undefined;
    if (!row) return null;
    return { id: row.id, label: row.label, revoked: row.revoked_at !== null };
  }

  revokeToken(id: string): RevokeResult {
    const existing = this.getTokenById(id);
    if (!existing) {
      throw new Error(`Token not found: ${id}`);
    }
    if (existing.revoked) {
      throw new Error(`Token already revoked: ${id}`);
    }

    const instanceRows = this.listInstancesForCredential(id);

    const revoke = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE tokens SET revoked_at = ? WHERE id = ?`)
        .run(nowIso(), id);
    });
    revoke();

    return { instanceIds: instanceRows };
  }

  validateToken(plaintext: string): ValidatedToken | null {
    const row = this.db
      .prepare(`SELECT id, label FROM tokens WHERE token_hash = ? AND revoked_at IS NULL`)
      .get(hashToken(plaintext)) as { id: string; label: string } | undefined;
    if (!row || row.id === LEGACY_CREDENTIAL_ID) return null;
    return { id: row.id, label: row.label };
  }

  listInstancesForCredential(credentialId: string): string[] {
    const rows = this.db
      .prepare(`SELECT instance_id FROM instances WHERE credential_id = ? ORDER BY created_at ASC`)
      .all(credentialId) as { instance_id: string }[];
    return rows.map((row) => row.instance_id);
  }

  registerInstance(credentialId: string, instanceId: string): void {
    this.db
      .prepare(`INSERT INTO instances (instance_id, credential_id, created_at) VALUES (?, ?, ?)`)
      .run(instanceId, credentialId, nowIso());
  }

  assertInstanceOwned(credentialId: string, instanceId: string): void {
    const row = this.db
      .prepare(`SELECT credential_id FROM instances WHERE instance_id = ?`)
      .get(instanceId) as { credential_id: string } | undefined;
    if (!row || row.credential_id !== credentialId) {
      throw new Error("Instance not owned by this credential");
    }
  }

  releaseInstance(credentialId: string, instanceId: string): void {
    this.db
      .prepare(`DELETE FROM instances WHERE instance_id = ? AND credential_id = ?`)
      .run(instanceId, credentialId);
  }

  deleteInstancesForCredential(credentialId: string): void {
    this.db.prepare(`DELETE FROM instances WHERE credential_id = ?`).run(credentialId);
  }
}

let sharedStore: TokenStore | undefined;

export function initTokenStore(dbPath: string): TokenStore {
  if (sharedStore) sharedStore.close();
  sharedStore = new TokenStore(dbPath);
  return sharedStore;
}

export function getTokenStore(): TokenStore {
  if (!sharedStore) {
    throw new Error("Token store not initialized");
  }
  return sharedStore;
}

/** @internal Test helper to reset the singleton. */
export function resetTokenStoreForTests(): void {
  sharedStore?.close();
  sharedStore = undefined;
}
