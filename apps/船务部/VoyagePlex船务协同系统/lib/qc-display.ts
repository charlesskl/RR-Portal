export type QcResult = {
  itemIndex: number;
  total: number;
  latest: null | {
    site: string;
    inspectionDate: string | null;
    internalResult: string;
    thirdPartyResult: string;
    holdRejectReason: string;
    workflowStatus: string;
  };
};

export type QcState = "pass" | "failed" | "exempt" | "pending" | "missing";

type QcItem = { contract_number?: unknown; customer_po?: unknown; product_code?: unknown; qc_snapshot?: unknown };
type QcSnapshot = { lookupKey: string; checkedAt: string; total: number; latest: QcResult["latest"] };

function lookupKey(item: QcItem): string {
  return JSON.stringify([item.contract_number, item.customer_po, item.product_code]
    .map(value => String(value || "").trim()));
}

export function saveQcSnapshots<T extends QcItem>(items: T[], results: QcResult[], checkedAt: string): T[] {
  const byIndex = new Map(results.map(result => [result.itemIndex, result]));
  return items.map((item, index) => {
    const result = byIndex.get(index);
    if (!result) return item;
    const qc_snapshot: QcSnapshot = { lookupKey: lookupKey(item), checkedAt, total: result.total, latest: result.latest };
    return { ...item, qc_snapshot };
  });
}

export function readQcSnapshots(items: QcItem[]): { results: QcResult[]; checkedAt: string } | null {
  const results: QcResult[] = [];
  let checkedAt = "";
  items.forEach((item, itemIndex) => {
    const snapshot = item.qc_snapshot as Partial<QcSnapshot> | undefined;
    if (!snapshot || snapshot.lookupKey !== lookupKey(item) || typeof snapshot.checkedAt !== "string" ||
      typeof snapshot.total !== "number" || !Number.isFinite(snapshot.total) ||
      (snapshot.latest !== null && (!snapshot.latest ||
        [snapshot.latest.internalResult, snapshot.latest.thirdPartyResult, snapshot.latest.workflowStatus].some(value => typeof value !== "string")))) return;
    results.push({ itemIndex, total: snapshot.total, latest: snapshot.latest });
    if (snapshot.checkedAt > checkedAt) checkedAt = snapshot.checkedAt;
  });
  return results.length ? { results, checkedAt } : null;
}

export function qcState(result: QcResult | undefined): QcState {
  if (!result?.latest) return "missing";
  const values = [result.latest.internalResult, result.latest.thirdPartyResult]
    .map(value => value.trim().toUpperCase());
  if (values.some(value => /^(REJ|HOLD|FAIL|FAILED|不通过|未通过)$/.test(value))) return "failed";
  if (result.latest.workflowStatus === "待复检") return "pending";
  if (values.includes("PASS") && result.latest.workflowStatus === "已完成") return "pass";
  if (values.some(Boolean) && values.every(value => !value || value === "NA" || value === "不用验")) return "exempt";
  return "pending";
}

export function qcResultText(result: QcResult | undefined): string {
  if (!result?.latest) return "未查到";
  return `${result.latest.internalResult?.trim() || "—"}/${result.latest.thirdPartyResult?.trim() || "—"}`;
}

export function qcSummary(items: Array<{ product_code?: unknown }>, results: QcResult[]) {
  const byIndex = new Map(results.map(result => [result.itemIndex, result]));
  const byProduct = new Map<string, QcState>();
  const priority: Record<QcState, number> = { pass: 0, exempt: 1, missing: 2, pending: 3, failed: 4 };
  items.forEach((item, index) => {
    const code = String(item.product_code || "").trim().toUpperCase();
    const key = code || `__ROW_${index}`;
    const state = qcState(byIndex.get(index));
    const previous = byProduct.get(key);
    if (!previous || priority[state] > priority[previous]) byProduct.set(key, state);
  });
  const states = Array.from(byProduct.values());
  const count = (state: QcState) => states.filter(value => value === state).length;
  const total = states.length;
  const pass = count("pass");
  const failed = count("failed");
  const exempt = count("exempt");
  const pending = count("pending");
  const missing = count("missing");
  return { total, pass, failed, exempt, pending, missing,
    text: total > 0 && pass === total ? `共${total}款货号，已全部PASS` :
      `共${total}款货号，PASS ${pass}款，未通过 ${failed}款${exempt ? `，不用验 ${exempt}款` : ""}${pending ? `，待确认 ${pending}款` : ""}${missing ? `，未查到 ${missing}款` : ""}` };
}
