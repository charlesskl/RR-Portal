const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/qc-display.ts"), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleRef = { exports: {} };
new Function("module", "exports", javascript)(moduleRef, moduleRef.exports);
const { qcResultText, qcState, qcSummary, readQcSnapshots, saveQcSnapshots } = moduleRef.exports;

function result(itemIndex, internalResult, thirdPartyResult = "NA", workflowStatus = "已完成") {
  return { itemIndex, total: 1, latest: { site: "兴信", inspectionDate: "2026-09-18", internalResult, thirdPartyResult, holdRejectReason: "", workflowStatus } };
}

test("相同货号只计一款，全部通过时显示全部 PASS", () => {
  const summary = qcSummary([{ product_code: "A" }, { product_code: "a" }], [result(0, "PASS"), result(1, "PASS")]);
  assert.equal(summary.total, 1);
  assert.equal(summary.text, "共1款货号，已全部PASS");
});

test("未通过、待确认和未查到分别统计", () => {
  const summary = qcSummary(
    [{ product_code: "A" }, { product_code: "B" }, { product_code: "C" }, { product_code: "D" }],
    [result(0, "PASS"), result(1, "HOLD", "NA", "HOLD"), result(2, "AOD")],
  );
  assert.equal(summary.text, "共4款货号，PASS 1款，未通过 1款，待确认 1款，未查到 1款");
  assert.equal(qcState(result(1, "PASS", "REJ", "REJ")), "failed");
});

test("同一货号只要有未通过记录，汇总不显示全部 PASS", () => {
  const summary = qcSummary([{ product_code: "A" }, { product_code: "A" }], [result(0, "PASS"), result(1, "REJ", "NA", "REJ")]);
  assert.equal(summary.total, 1);
  assert.equal(summary.failed, 1);
});

test("验货结果保留 QC 原值，并用斜杠对应表头顺序", () => {
  assert.equal(qcResultText(result(0, "PASS", "HOLD")), "PASS/HOLD");
  assert.equal(qcResultText(result(0, "PASS")), "PASS/NA");
  assert.equal(qcResultText(result(0, "NA", "PASS")), "NA/PASS");
  assert.equal(qcResultText(result(0, "PASS", "")), "PASS/—");
});

test("NA 表示不用验，单独汇总", () => {
  const summary = qcSummary([{ product_code: "A" }, { product_code: "B" }], [result(0, "PASS"), result(1, "NA", "NA", "不用验")]);
  assert.equal(summary.text, "共2款货号，PASS 1款，未通过 0款，不用验 1款");
  assert.equal(qcState(result(1, "NA", "NA", "不用验")), "exempt");
});

test("保存后可恢复逐行验货结果和查询时间", () => {
  const items = [{ contract_number: "123", customer_po: "PO-1", product_code: "A" }, { contract_number: "123", customer_po: "PO-2", product_code: "B" }];
  const checkedAt = "2026-09-18T02:00:00.000Z";
  const saved = saveQcSnapshots(items, [result(0, "PASS"), { itemIndex: 1, total: 0, latest: null }], checkedAt);
  const restored = readQcSnapshots(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.checkedAt, checkedAt);
  assert.equal(restored.results[0].latest.internalResult, "PASS");
  assert.equal(restored.results[1].latest, null);
  assert.equal(items[0].qc_snapshot, undefined);
});

test("查询条件改变后不恢复旧结果", () => {
  const item = { contract_number: "123", customer_po: "PO-1", product_code: "A" };
  const saved = saveQcSnapshots([item], [result(0, "PASS")], "2026-09-18T02:00:00.000Z");
  assert.equal(readQcSnapshots([{ ...saved[0], product_code: "B" }]), null);
});
