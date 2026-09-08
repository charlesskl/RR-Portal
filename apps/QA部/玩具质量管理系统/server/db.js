// SQLite storage layer for the ToyQMS backend.
// Uses the built-in node:sqlite module (Node >= 22.5) — no native dependencies.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TOYQMS_DATA_DIR || path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "toyqms.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS complaints (
  id            TEXT PRIMARY KEY,
  duplicate_key TEXT NOT NULL UNIQUE,
  primary_series TEXT NOT NULL DEFAULT '',
  issue_type    TEXT,
  status        TEXT NOT NULL DEFAULT 'Needs classification',
  updated_at    TEXT NOT NULL,
  data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_complaints_series ON complaints(primary_series);
CREATE INDEX IF NOT EXISTS idx_complaints_issue  ON complaints(issue_type);

CREATE TABLE IF NOT EXISTS caps (
  id         TEXT PRIMARY KEY,
  cap_number TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL,
  data       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_types (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS issue_type_names (
  name         TEXT PRIMARY KEY,
  chinese_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS series_names (
  kind         TEXT NOT NULL,          -- 'primary' | 'secondary'
  key          TEXT NOT NULL,          -- primary: name; secondary: primaryName + '' + name
  chinese_name TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);

CREATE TABLE IF NOT EXISTS import_history (
  batch_id TEXT PRIMARY KEY,
  data     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  login_name_norm  TEXT NOT NULL UNIQUE,
  enabled          INTEGER NOT NULL DEFAULT 1,
  data             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
