// Business logic for complaints / CAP / series / issue types / backup.
// Ported 1:1 from the browser LocalStorageComplaintRepository so behavior matches.
import { db, now } from "./db.js";

const SEP = "\u0000"; // key separator used by the frontend for secondary series names

// ---------- shared helpers (ported from lib/excel.ts / lib/repository.ts) ----------

const text = (v) => (v == null ? "" : String(v).trim());
const normalized = (v) => text(v).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");

export function translationSourceHashOf(message) {
  let hash = 2166136261;
  for (let index = 0; index < message.length; index++) {
    hash ^= message.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function duplicateKeyOf(input) {
  return [input.contactDate, input.productSku, input.complaintMessageOriginal, input.country, input.store, input.batchCode, input.primarySeries]
    .map(normalized)
    .join("¦");
}

const commonChineseNames = {
  "missing parts": "零件缺失", "missing part": "零件缺失", "parts missing": "零件缺失",
  "functional failure": "功能故障", "function failure": "功能故障", "functionality": "功能故障",
  "appearance": "外观缺陷", "cosmetic": "外观缺陷", "packaging": "包装问题",
  "damaged": "产品损坏", "damage": "产品损坏", "safety": "安全问题",
  "instructions": "说明书问题", "instruction": "说明书问题", "wrong item": "商品错误",
  "quality": "质量问题", "delivery": "配送问题"
};

export function defaultChineseIssueName(name) {
  if (/[㐀-鿿]/.test(name)) return name;
  const norm = name.trim().toLowerCase();
  if (commonChineseNames[norm]) return commonChineseNames[norm];
  const match = Object.entries(commonChineseNames).find(([key]) => norm.includes(key));
  return match?.[1] || "未设置中文类型";
}

const defaultConfig = { preserveOriginalText: true, requireHumanReview: true, recalculateStatistics: true };

function withTranslationFields(record) {
  const rawTranslation = Object.entries(record.rawData || {})
    .find(([key, item]) => /(chinese|translation|translated|中文|译文)/i.test(key) && typeof item === "string" && item.trim())?.[1];
  const imported = typeof rawTranslation === "string" ? rawTranslation.trim() : null;
  const machine = record.complaintMessageZhMachine ?? imported;
  const finalText = record.complaintMessageZhFinal ?? null;
  const status = record.translationStatus ?? (finalText ? "reviewed" : machine ? "translated" : "pending");
  return {
    ...record,
    capIds: Array.isArray(record.capIds) ? record.capIds : [],
    duplicateKey: record.duplicateKey || duplicateKeyOf(record),
    sourceLanguage: record.sourceLanguage || "en",
    complaintMessageZhMachine: machine,
    complaintMessageZhFinal: finalText,
    translationStatus: status,
    translationSourceHash: record.translationSourceHash || translationSourceHashOf(record.complaintMessageOriginal),
    translationProvider: record.translationProvider ?? (imported ? "excel-import" : null),
    translationModel: record.translationModel ?? null,
    translatedAt: record.translatedAt ?? (machine ? record.importedAt : null),
    reviewedAt: record.reviewedAt ?? null
  };
}

// ---------- low-level row access ----------

function rows(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map((row) => JSON.parse(row.data));
}
function readComplaints() { return rows("complaints").map(withTranslationFields); }
function readCAPs() {
  return rows("caps").map((cap) => ({ ...cap, complaintIds: Array.isArray(cap.complaintIds) ? cap.complaintIds : [] }));
}
function writeComplaint(record) {
  db.prepare(`INSERT INTO complaints (id, duplicate_key, primary_series, issue_type, status, updated_at, data)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET duplicate_key=excluded.duplicate_key, primary_series=excluded.primary_series,
                issue_type=excluded.issue_type, status=excluded.status, updated_at=excluded.updated_at, data=excluded.data`)
    .run(record.id, record.duplicateKey, record.primarySeries || "", record.issueType ?? null, record.status, record.updatedAt, JSON.stringify(record));
}
function writeCAP(cap) {
  db.prepare(`INSERT INTO caps (id, cap_number, updated_at, data) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET cap_number=excluded.cap_number, updated_at=excluded.updated_at, data=excluded.data`)
    .run(cap.id, cap.capNumber, cap.updatedAt, JSON.stringify(cap));
}
function readIssueTypeNameMap() {
  const map = {};
  for (const row of db.prepare("SELECT name, chinese_name FROM issue_type_names").all()) map[row.name] = row.chinese_name;
  return map;
}
function readSeriesNameMap(kind) {
  const map = {};
  for (const row of db.prepare("SELECT key, chinese_name FROM series_names WHERE kind = ?").all(kind)) map[row.key] = row.chinese_name;
  return map;
}
function readHistory() {
  return db.prepare("SELECT data FROM import_history ORDER BY rowid DESC").all().map((row) => JSON.parse(row.data));
}

// ---------- public repository API (mirrors ComplaintRepository in lib/repository.ts) ----------

export function getAll() { return readComplaints(); }

export function importNew(records, summary) {
  const safe = records.filter((r) => !db.prepare("SELECT 1 FROM complaints WHERE duplicate_key = ?").get(r.duplicateKey));
  db.exec("BEGIN");
  try {
    for (const record of safe) writeComplaint(record);
    db.prepare("INSERT OR REPLACE INTO import_history (batch_id, data) VALUES (?, ?)")
      .run(summary.batchId, JSON.stringify({ ...summary, importedRows: safe.length }));
    db.exec("DELETE FROM import_history WHERE batch_id NOT IN (SELECT batch_id FROM import_history ORDER BY rowid DESC LIMIT 30)");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return safe.length;
}

export function getImportHistory() { return readHistory(); }

export function getIssueTypes() {
  const saved = db.prepare("SELECT name FROM issue_types").all().map((row) => row.name);
  const fromRecords = readComplaints().map((r) => r.issueType).filter(Boolean);
  return [...new Set([...saved, ...fromRecords])].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function getIssueTypeDefinitions() {
  const saved = readIssueTypeNameMap();
  return getIssueTypes().map((name) => ({ name, chineseName: saved[name]?.trim() || defaultChineseIssueName(name) }));
}

export function saveIssueType(name) {
  const clean = name.trim();
  if (clean) db.prepare("INSERT OR IGNORE INTO issue_types (name) VALUES (?)").run(clean);
  return getIssueTypes();
}

export function updateIssueTypeChineseName(name, chineseName) {
  const clean = chineseName.trim();
  db.prepare("INSERT INTO issue_type_names (name, chinese_name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET chinese_name=excluded.chinese_name")
    .run(name, clean || defaultChineseIssueName(name));
}

export function getSeriesDefinitions() {
  const records = readComplaints();
  const primaryMap = readSeriesNameMap("primary");
  const secondaryMap = readSeriesNameMap("secondary");
  const primary = [...new Set(records.map((record) => record.primarySeries).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => ({ name, chineseName: primaryMap[name]?.trim() || name, kind: "primary", primarySeriesName: null }));
  const pairs = new Map();
  for (const record of records) {
    if (!record.secondarySeries) continue;
    pairs.set(`${record.primarySeries}${SEP}${record.secondarySeries}`, { name: record.secondarySeries, primarySeriesName: record.primarySeries });
  }
  const secondary = [...pairs.entries()]
    .map(([key, item]) => ({ name: item.name, chineseName: secondaryMap[key]?.trim() || item.name, kind: "secondary", primarySeriesName: item.primarySeriesName }))
    .sort((a, b) => a.primarySeriesName.localeCompare(b.primarySeriesName, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
  return { primary, secondary };
}

export function updateSeriesChineseName(kind, name, chineseName, primarySeriesName = null) {
  const key = kind === "primary" ? name : `${primarySeriesName || ""}${SEP}${name}`;
  db.prepare("INSERT INTO series_names (kind, key, chinese_name) VALUES (?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET chinese_name=excluded.chinese_name")
    .run(kind, key, chineseName.trim() || name);
}

export function updateComplaintIssue(id, issueType) {
  const record = readComplaints().find((r) => r.id === id);
  if (!record) return;
  writeComplaint({ ...record, issueType, status: issueType ? "Imported" : "Needs classification", updatedAt: now() });
  if (issueType) saveIssueType(issueType);
}

export function updateComplaint(id, changes) {
  const current = readComplaints().find((record) => record.id === id);
  if (!current) throw new Error("投诉记录不存在或已被删除。");
  const cleanChanges = {
    ...changes,
    productName: changes.productName === undefined ? current.productName : changes.productName?.trim() || null,
    secondarySeries: changes.secondarySeries === undefined ? current.secondarySeries : changes.secondarySeries?.trim() || null,
    store: changes.store === undefined ? current.store : changes.store?.trim() || null,
    batchCode: changes.batchCode === undefined ? current.batchCode : changes.batchCode?.trim() || null,
    issueType: changes.issueType === undefined ? current.issueType : changes.issueType?.trim() || null
  };
  const updated = { ...current, ...cleanChanges, status: cleanChanges.issueType ? "Imported" : "Needs classification", updatedAt: now() };
  updated.duplicateKey = duplicateKeyOf(updated);
  const clash = db.prepare("SELECT id FROM complaints WHERE duplicate_key = ? AND id != ?").get(updated.duplicateKey, id);
  if (clash) throw new Error("编辑后的记录与现有投诉重复，无法保存。");
  writeComplaint(updated);
  if (updated.issueType) saveIssueType(updated.issueType);
}

export function updateComplaintStatuses(ids, workflowStatus) {
  const selected = new Set(ids);
  let updated = 0, skipped = 0;
  db.exec("BEGIN");
  try {
    for (const record of readComplaints()) {
      if (!selected.has(record.id)) continue;
      if (!record.issueType) { skipped += 1; continue; }
      updated += 1;
      writeComplaint({ ...record, workflowStatus, updatedAt: now() });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { updated, skipped };
}

export function updateComplaintTranslation(id, changes) {
  const current = readComplaints().find((record) => record.id === id);
  if (!current) throw new Error("投诉记录不存在或已被删除。");
  const timestamp = now();
  const machine = changes.complaintMessageZhMachine === undefined ? current.complaintMessageZhMachine : changes.complaintMessageZhMachine?.trim() || null;
  const finalText = changes.complaintMessageZhFinal === undefined ? current.complaintMessageZhFinal : changes.complaintMessageZhFinal?.trim() || null;
  let status = changes.translationStatus ?? current.translationStatus;
  if (status === "reviewed" && !finalText) throw new Error("确认译文前必须填写最终中文译文。");
  if (status === "translated" && !machine) status = "pending";
  writeComplaint({
    ...current, ...changes, complaintMessageZhMachine: machine, complaintMessageZhFinal: finalText,
    translationStatus: status, translationSourceHash: translationSourceHashOf(current.complaintMessageOriginal),
    translatedAt: status === "translated" || status === "reviewed" ? current.translatedAt || timestamp : null,
    reviewedAt: status === "reviewed" ? timestamp : null, updatedAt: timestamp
  });
}

export function importTranslations(rowsInput, invalidRows) {
  const records = readComplaints();
  const timestamp = now();
  let importedRows = 0, unmatchedRows = 0;
  const byKey = new Map(records.map((record) => [record.duplicateKey, record]));
  const bySubmission = new Map(records.filter((record) => record.sourceSubmissionId).map((record) => [record.sourceSubmissionId, record]));
  const byOriginal = new Map(records.map((record) => [translationSourceHashOf(record.complaintMessageOriginal), record]));
  const updates = new Map();
  for (const row of rowsInput) {
    const target = (row.duplicateKey && byKey.get(row.duplicateKey))
      || (row.sourceSubmissionId && bySubmission.get(row.sourceSubmissionId))
      || (row.complaintMessageOriginal && byOriginal.get(translationSourceHashOf(row.complaintMessageOriginal)));
    if (!target) { unmatchedRows += 1; continue; }
    updates.set(target.id, row.complaintMessageZh);
    importedRows += 1;
  }
  db.exec("BEGIN");
  try {
    for (const record of records) {
      const translation = updates.get(record.id);
      if (!translation) continue;
      writeComplaint({
        ...record, complaintMessageZhMachine: translation, complaintMessageZhFinal: null,
        translationStatus: "translated", translationSourceHash: translationSourceHashOf(record.complaintMessageOriginal),
        translationProvider: "excel-translation-import", translationModel: null,
        translatedAt: timestamp, reviewedAt: null, updatedAt: timestamp
      });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { totalRows: rowsInput.length + invalidRows, importedRows, unmatchedRows, invalidRows };
}

export function confirmTranslations(ids) {
  const idSet = new Set(ids);
  if (!idSet.size) return 0;
  const timestamp = now();
  let confirmed = 0;
  db.exec("BEGIN");
  try {
    for (const record of readComplaints()) {
      if (!idSet.has(record.id)) continue;
      const translation = (record.complaintMessageZhFinal || record.complaintMessageZhMachine || "").trim();
      if (!translation) continue;
      confirmed += 1;
      writeComplaint({ ...record, complaintMessageZhFinal: translation, translationStatus: "reviewed", reviewedAt: timestamp, updatedAt: timestamp });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return confirmed;
}

export function resetOfflineTranslations() {
  const timestamp = now();
  let reset = 0;
  db.exec("BEGIN");
  try {
    for (const record of readComplaints()) {
      if (record.translationProvider !== "codex-offline" || record.translationModel !== "argos-en-zh") continue;
      reset += 1;
      writeComplaint({
        ...record, complaintMessageZhMachine: null, complaintMessageZhFinal: null, translationStatus: "pending",
        translationProvider: null, translationModel: null, translatedAt: null, reviewedAt: null,
        translationSourceHash: translationSourceHashOf(record.complaintMessageOriginal), updatedAt: timestamp
      });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return reset;
}

export function deleteComplaints(ids) {
  const idSet = new Set(ids);
  if (!idSet.size) return 0;
  const timestamp = now();
  const before = db.prepare("SELECT COUNT(*) AS n FROM complaints").get().n;
  db.exec("BEGIN");
  try {
    for (const id of idSet) db.prepare("DELETE FROM complaints WHERE id = ?").run(id);
    for (const cap of readCAPs()) {
      const kept = cap.complaintIds.filter((cid) => !idSet.has(cid));
      if (kept.length !== cap.complaintIds.length) writeCAP({ ...cap, complaintIds: kept, updatedAt: timestamp });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return before - db.prepare("SELECT COUNT(*) AS n FROM complaints").get().n;
}

export function getCAPs() { return readCAPs(); }

function nextCAPNumber(caps) {
  const year = new Date().getFullYear();
  const prefix = `CAP-${year}-`;
  const max = caps.filter((cap) => cap.capNumber.startsWith(prefix))
    .reduce((value, cap) => Math.max(value, Number(cap.capNumber.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function saveCAP(input, id) {
  const caps = readCAPs();
  const records = readComplaints();
  const timestamp = now();
  const current = id ? caps.find((cap) => cap.id === id) : undefined;
  if (id && !current) throw new Error("CAP 记录不存在或已被删除。");
  const allowedIds = new Set(records.map((record) => record.id));
  const complaintIds = [...new Set(input.complaintIds)].filter((item) => allowedIds.has(item));
  const saved = {
    ...input, complaintIds,
    id: current?.id || crypto.randomUUID(),
    capNumber: current?.capNumber || nextCAPNumber(caps),
    createdAt: current?.createdAt || timestamp, updatedAt: timestamp
  };
  const oldIds = new Set(current?.complaintIds || []);
  const newIds = new Set(complaintIds);
  db.exec("BEGIN");
  try {
    writeCAP(saved);
    for (const record of records) {
      if (!oldIds.has(record.id) && !newIds.has(record.id)) continue;
      const capIds = new Set(record.capIds || []);
      if (newIds.has(record.id)) capIds.add(saved.id); else capIds.delete(saved.id);
      writeComplaint({ ...record, capIds: [...capIds], updatedAt: timestamp });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return saved;
}

export function deleteCAP(id) {
  if (!db.prepare("SELECT 1 FROM caps WHERE id = ?").get(id)) return;
  const timestamp = now();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM caps WHERE id = ?").run(id);
    for (const record of readComplaints()) {
      if (!record.capIds?.includes(id)) continue;
      writeComplaint({ ...record, capIds: record.capIds.filter((capId) => capId !== id), updatedAt: timestamp });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

// ---------- config / backup ----------

export function getConfig() {
  const row = db.prepare("SELECT data FROM config WHERE id = 1").get();
  return row ? JSON.parse(row.data) : defaultConfig;
}
function writeConfig(config) {
  db.prepare("INSERT INTO config (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data")
    .run(JSON.stringify(config || defaultConfig));
}

export function exportLocalData() {
  return {
    schemaVersion: 2,
    product: "ToyQMS",
    exportedAt: now(),
    complaintRecords: readComplaints(),
    capRecords: readCAPs(),
    importHistory: readHistory(),
    issueTypes: db.prepare("SELECT name FROM issue_types").all().map((row) => row.name),
    issueTypeChineseNames: readIssueTypeNameMap(),
    primarySeriesChineseNames: readSeriesNameMap("primary"),
    secondarySeriesChineseNames: readSeriesNameMap("secondary"),
    systemConfig: getConfig()
  };
}

export function restoreLocalData(backup) {
  if (!backup || backup.product !== "ToyQMS" || ![1, 2].includes(backup.schemaVersion)
    || !Array.isArray(backup.complaintRecords) || !Array.isArray(backup.importHistory) || !Array.isArray(backup.issueTypes)) {
    throw new Error("备份文件格式不正确或版本不受支持。");
  }
  const maps = [backup.issueTypeChineseNames, backup.primarySeriesChineseNames, backup.secondarySeriesChineseNames];
  if (maps.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("备份文件中的名称映射无效。");
  }
  const caps = Array.isArray(backup.capRecords) ? backup.capRecords : [];
  const capIds = new Set(caps.map((cap) => cap.id));
  const complaintIds = new Set(backup.complaintRecords.map((record) => record.id));
  const cleanCaps = caps.map((cap) => ({ ...cap, complaintIds: (cap.complaintIds || []).filter((cid) => complaintIds.has(cid)) }));
  const capComplaintMap = new Map();
  for (const cap of cleanCaps) {
    for (const complaintId of cap.complaintIds) {
      const ids = capComplaintMap.get(complaintId) || new Set();
      ids.add(cap.id);
      capComplaintMap.set(complaintId, ids);
    }
  }
  const cleanRecords = backup.complaintRecords.map((record) => ({
    ...record,
    capIds: [...new Set([...(record.capIds || []).filter((cid) => capIds.has(cid)), ...(capComplaintMap.get(record.id) || [])])]
  }));
  db.exec("BEGIN");
  try {
    clearTables();
    for (const record of cleanRecords) writeComplaint(record);
    for (const cap of cleanCaps) writeCAP(cap);
    for (const summary of backup.importHistory.slice(0, 30)) {
      db.prepare("INSERT OR REPLACE INTO import_history (batch_id, data) VALUES (?, ?)").run(summary.batchId, JSON.stringify(summary));
    }
    for (const name of backup.issueTypes) db.prepare("INSERT OR IGNORE INTO issue_types (name) VALUES (?)").run(name);
    for (const [name, chineseName] of Object.entries(backup.issueTypeChineseNames)) {
      db.prepare("INSERT OR REPLACE INTO issue_type_names (name, chinese_name) VALUES (?, ?)").run(name, chineseName);
    }
    for (const [key, chineseName] of Object.entries(backup.primarySeriesChineseNames)) {
      db.prepare("INSERT OR REPLACE INTO series_names (kind, key, chinese_name) VALUES ('primary', ?, ?)").run(key, chineseName);
    }
    for (const [key, chineseName] of Object.entries(backup.secondarySeriesChineseNames)) {
      db.prepare("INSERT OR REPLACE INTO series_names (kind, key, chinese_name) VALUES ('secondary', ?, ?)").run(key, chineseName);
    }
    writeConfig(backup.systemConfig);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function clearTables() {
  for (const table of ["complaints", "caps", "import_history", "issue_types", "issue_type_names", "series_names"]) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec("DELETE FROM config WHERE id = 1");
}

export function clear() { clearTables(); }
