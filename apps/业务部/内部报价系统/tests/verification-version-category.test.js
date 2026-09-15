const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('verification versions persist an editable category with an idempotent SQLite migration', () => {
  const schema = read('backend/db/schema.sql');
  const sqlite = read('backend/db/sqlite.js');
  assert.match(schema, /quote_verification_versions[\s\S]*category\s+TEXT/);
  assert.match(sqlite, /ALTER TABLE quote_verification_versions ADD COLUMN category TEXT/);
});

test('PostgreSQL schema and legacy migration include the complete verification workflow', () => {
  const schema = read('backend/db/schema.postgres.sql');
  const postgres = read('backend/db/postgres.js');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS quote_verifications/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS quote_verification_versions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS quote_verification_sections/);
  assert.match(schema, /ALTER TABLE quote_verification_versions ADD COLUMN IF NOT EXISTS category TEXT/);
  assert.match(postgres, /'quote_customer_confirmations', 'quote_verifications', 'quote_verification_versions'/);
  assert.match(postgres, /'quote_verification_versions', 'quote_verification_sections'/);
});

test('authorized version managers can update category and the UI displays it with the fixed version number', () => {
  const routes = read('backend/routes/verifications.js');
  const frontend = read('frontend/verification.js');
  assert.match(routes, /router\.patch\('\/versions\/:versionId'/);
  assert.match(routes, /只有业务、工程或管理员可以编辑版本类别/);
  assert.match(frontend, /const versionTitle = version =>/);
  assert.match(frontend, /版本类别/);
  assert.match(frontend, /method: 'PATCH'/);
  assert.match(frontend, /current_version_category/);
});

test('verification routes use SQL shared by SQLite and PostgreSQL', () => {
  const routes = read('backend/routes/verifications.js');
  assert.doesNotMatch(routes, /PRAGMA\s+table_info/i);
  assert.match(routes, /VALUES \(\?, \?, \?, \?, \?, 'drafting', \?\) RETURNING id/);
  assert.match(routes, /const tx = db\.transaction\(async \(\) =>/);
});
