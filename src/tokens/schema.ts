import type Database from "better-sqlite3";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS tokens (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS instances (
    instance_id   TEXT PRIMARY KEY,
    credential_id TEXT NOT NULL REFERENCES tokens(id),
    created_at    TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_instances_credential_id ON instances(credential_id)`
];

function instancesColumnNames(db: Database.Database): string[] {
  const rows = db.prepare("PRAGMA table_info(instances)").all() as { name: string }[];
  return rows.map((row) => row.name);
}

/** Apply idempotent schema migrations and enable foreign keys. */
export function migrateSchema(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }

  const columns = instancesColumnNames(db);
  if (columns.includes("token_id") && !columns.includes("credential_id")) {
    db.exec("ALTER TABLE instances RENAME COLUMN token_id TO credential_id");
  }
  if (columns.includes("token_id")) {
    db.exec("DROP INDEX IF EXISTS idx_instances_token_id");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_instances_credential_id ON instances(credential_id)");
}
