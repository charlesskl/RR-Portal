// End-to-end smoke test for the ToyQMS API.
// Spawns the server with a temporary data directory, exercises the main flows,
// and asserts the same behavior the browser UI relies on.
// Run: npm run smoke
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { duplicateKeyOf } from "../repository.js";

const PORT = 43399;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "toyqms-smoke-"));

const server = spawn(process.execPath, ["index.js"], {
  env: { ...process.env, PORT: String(PORT), TOYQMS_DATA_DIR: dataDir, NODE_ENV: "test" },
  stdio: "inherit"
});
process.on("exit", () => server.kill());

let token = "";
const api = async (method, url, body, expectOk = true) => {
  const response = await fetch(BASE + url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (expectOk && !response.ok) throw new Error(`${method} ${url} -> ${response.status}: ${JSON.stringify(data)}`);
  return { status: response.status, data };
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("server did not start");
};

const makeRecord = (overrides = {}) => ({
  id: crypto.randomUUID(),
  sourceSubmissionId: null,
  sourceFileName: "smoke.xlsx",
  sourceWorksheetName: "Doll",
  sourceRowNumber: 2,
  importBatchId: "batch-smoke",
  primarySeries: "Doll",
  secondarySeries: "Doll Classic",
  contactDate: "2026-09-01",
  productSku: "SKU-1",
  productName: "Test Doll",
  complaintMessageOriginal: "Missing parts in the box",
  sourceLanguage: "en",
  complaintMessageZhMachine: null,
  complaintMessageZhFinal: null,
  translationStatus: "pending",
  translationSourceHash: "",
  translationProvider: null,
  translationModel: null,
  translatedAt: null,
  reviewedAt: null,
  country: "US",
  store: "Amazon",
  batchCode: "B1",
  issueType: null,
  status: "Needs classification",
  workflowStatus: null,
  capIds: [],
  duplicateKey: "",
  importedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rawData: {},
  ...overrides
});

const withKey = (record) => ({ ...record, duplicateKey: duplicateKeyOf(record) });

const main = async () => {
  await waitForServer();

  // auth
  const bad = await api("POST", "/auth/login", { loginName: "JC", password: "wrong-pass" }, false);
  assert.equal(bad.status, 400);
  const login = await api("POST", "/auth/login", { loginName: "jc", password: "12345678" });
  assert.equal(login.data.user.loginName, "JC");
  assert.equal(login.data.user.mustChangePassword, true);
  assert.equal(login.data.user.passwordHash, undefined, "password hash must not leak");
  token = login.data.token;

  // unauthorized without token
  token = "";
  const denied = await api("GET", "/complaints", undefined, false);
  assert.equal(denied.status, 401);
  token = login.data.token;

  // import complaints (incl. one duplicate)
  const r1 = withKey(makeRecord());
  const r2 = withKey(makeRecord({ id: crypto.randomUUID(), productSku: "SKU-2", issueType: "missing parts", status: "Imported" }));
  const summary = { totalRows: 2, newRows: 2, duplicateRows: 0, invalidRows: 0, importedRows: 0, batchId: "batch-smoke", fileName: "smoke.xlsx" };
  const imported = await api("POST", "/complaints/import", { records: [r1, r2], summary });
  assert.equal(imported.data.imported, 2);
  const again = await api("POST", "/complaints/import", { records: [r1], summary: { ...summary, batchId: "batch-smoke-2" } });
  assert.equal(again.data.imported, 0, "duplicateKey must be deduped");

  const all = await api("GET", "/complaints");
  assert.equal(all.data.length, 2);

  // issue types & series
  const types = await api("GET", "/issue-types");
  assert.deepEqual(types.data, ["missing parts"]);
  await api("POST", "/issue-types", { name: "外观缺陷" });
  await api("PUT", "/issue-types/chinese-name", { name: "missing parts", chineseName: "零件缺失" });
  const defs = await api("GET", "/issue-type-definitions");
  assert.equal(defs.data.find((d) => d.name === "missing parts").chineseName, "零件缺失");
  const series = await api("GET", "/series-definitions");
  assert.equal(series.data.primary[0].name, "Doll");
  assert.equal(series.data.secondary[0].name, "Doll Classic");
  await api("PUT", "/series-definitions/chinese-name", { kind: "primary", name: "Doll", chineseName: "娃娃系列" });
  const series2 = await api("GET", "/series-definitions");
  assert.equal(series2.data.primary[0].chineseName, "娃娃系列");

  // edit complaint, duplicate guard
  await api("PATCH", `/complaints/${r1.id}`, { issueType: "missing parts" });
  const dup = await api("PATCH", `/complaints/${r1.id}`, { productSku: "SKU-2", primarySeries: "Doll" }, false);
  assert.equal(dup.status, 400, "duplicate edit must be rejected");

  // workflow status (r1 now has issueType -> updated; r2 too)
  const st = await api("POST", "/complaints/status", { ids: [r1.id, r2.id], status: "处理中" });
  assert.deepEqual(st.data, { updated: 2, skipped: 0 });

  // translation flow
  await api("PATCH", `/complaints/${r1.id}/translation`, { complaintMessageZhMachine: "盒内缺少零件" });
  const reviewedEarly = await api("PATCH", `/complaints/${r1.id}/translation`, { translationStatus: "reviewed" }, false);
  assert.equal(reviewedEarly.status, 400, "reviewed without final text must fail");
  await api("PATCH", `/complaints/${r1.id}/translation`, { complaintMessageZhFinal: "盒内缺少零件（已确认）", translationStatus: "reviewed" });
  const imp = await api("POST", "/translations/import", { rows: [{ duplicateKey: r2.duplicateKey, sourceSubmissionId: null, complaintMessageOriginal: null, complaintMessageZh: "缺少零件", sourceWorksheetName: null, sourceRowNumber: null }], invalidRows: 1 });
  assert.deepEqual(imp.data, { totalRows: 2, importedRows: 1, unmatchedRows: 0, invalidRows: 1 });
  const confirmed = await api("POST", "/translations/confirm", { ids: [r2.id] });
  assert.equal(confirmed.data.confirmed, 1);

  // CAP create + link sync
  const cap = await api("PUT", "/caps", {
    input: {
      problemDescription: "重复出现缺零件", issueType: "missing parts", owner: "JC", stage: "草稿",
      dueDate: "2026-10-01", rootCauseAnalysis: "", correctiveAction: "", preventiveAction: "",
      effectivenessVerification: "", complaintIds: [r1.id, r2.id]
    }
  });
  assert.match(cap.data.capNumber, /^CAP-\d{4}-001$/);
  const afterCap = await api("GET", "/complaints");
  assert.ok(afterCap.data.every((r) => r.capIds.includes(cap.data.id)), "complaint.capIds must sync");

  // import history
  const history = await api("GET", "/import-history");
  assert.equal(history.data.length, 2);

  // backup & restore
  const backup = await api("GET", "/backup");
  assert.equal(backup.data.product, "ToyQMS");
  assert.equal(backup.data.complaintRecords.length, 2);
  await api("POST", "/clear");
  assert.equal((await api("GET", "/complaints")).data.length, 0);
  await api("POST", "/backup/restore", backup.data);
  assert.equal((await api("GET", "/complaints")).data.length, 2, "restore must bring records back");

  // users management
  const created = await api("POST", "/users", { name: "测试员", responsibility: "QA", loginName: "tester", category: "viewer" });
  assert.equal(created.data.mustChangePassword, true);
  const users = await api("GET", "/users");
  assert.equal(users.data.length, 2);
  const dupUser = await api("POST", "/users", { name: "重复", responsibility: "QA", loginName: "TESTER", category: "viewer" }, false);
  assert.equal(dupUser.status, 400);
  const delPrimary = await api("DELETE", `/users/${login.data.user.id}`, undefined, false);
  assert.equal(delPrimary.status, 400, "cannot delete self");
  // new user can log in with default password
  const login2 = await api("POST", "/auth/login", { loginName: "tester", password: "12345678" });
  token = login2.data.token;
  const forbidden = await api("POST", "/users", { name: "x", responsibility: "y", loginName: "z", category: "viewer" }, false);
  assert.equal(forbidden.status, 403, "viewer must not manage users");
  await api("POST", "/auth/change-password", { currentPassword: "12345678", newPassword: "newpassword9" });
  token = login.data.token;

  // delete complaints strips CAP links
  const del = await api("POST", "/complaints/delete", { ids: [r1.id, r2.id] });
  assert.equal(del.data.deleted, 2);
  const caps = await api("GET", "/caps");
  assert.deepEqual(caps.data[0].complaintIds, [], "CAP complaintIds must be cleaned");

  // bulk user import (local -> remote migration): passwords must survive
  const encoder = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Buffer.from(saltBytes).toString("base64");
  const material = await crypto.subtle.importKey("raw", encoder.encode("imported-pass-1"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: 120000, hash: "SHA-256" }, material, 256);
  const hash = Buffer.from(new Uint8Array(bits)).toString("base64");
  const importedUsers = await api("POST", "/users/import", {
    users: [{
      name: "海英", responsibility: "测试", loginName: "ying", category: "all",
      permissions: ["view_dashboard", "view_complaints", "manage_complaints", "delete_complaints", "view_analysis", "manage_classification", "manage_translation", "import_data", "view_cap", "manage_cap", "view_reports", "export_reports", "manage_users", "manage_settings", "view_audit"],
      enabled: true, mustChangePassword: false, passwordHash: hash, passwordSalt: salt, createdAt: new Date().toISOString()
    }]
  });
  assert.equal(importedUsers.data.imported, 1);
  // import clears every session -> old token rejected
  const stale = await api("GET", "/complaints", undefined, false);
  assert.equal(stale.status, 401, "sessions must be invalidated after import");
  // imported user logs in with the original password
  const login3 = await api("POST", "/auth/login", { loginName: "YING", password: "imported-pass-1" });
  assert.equal(login3.data.user.name, "海英");
  assert.equal(login3.data.user.mustChangePassword, false);
  // re-login as admin for any later checks
  token = (await api("POST", "/auth/login", { loginName: "JC", password: "12345678" })).data.token;
  const usersAfterImport = await api("GET", "/users");
  assert.equal(usersAfterImport.data.length, 3);

  console.log("✓ smoke test passed");
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};

main().catch((error) => {
  console.error("✗ smoke test failed:", error);
  server.kill();
  process.exit(1);
});
