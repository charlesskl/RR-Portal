import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { ORDER_STATUSES } from "@/lib/orderStatus";
import { inProductionQuantity } from "@/lib/orderFilter";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each(["length", "key", "removeItem"])("memory invalidation survives sessionStorage %s failure", async failure => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    get length() { if (failure === "length") throw new Error("blocked"); return 1; },
    key: () => { if (failure === "key") throw new Error("blocked"); return "sprayplan:/api/orders/overview"; },
    removeItem: () => { if (failure === "removeItem") throw new Error("blocked"); },
  };
  vi.stubGlobal("window", { sessionStorage: storage });
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ revision: fetch.mock.calls.length }) }));
  vi.stubGlobal("fetch", fetch);
  const { cachedJson, invalidateClientCache } = await import("@/lib/clientCache");
  await cachedJson("/api/orders/overview", 60_000);
  await cachedJson("/api/settings", 60_000);
  expect(() => invalidateClientCache("/api/orders")).not.toThrow();
  await cachedJson("/api/settings", 60_000);
  await cachedJson("/api/orders/overview", 60_000);
  expect(fetch).toHaveBeenCalledTimes(3);
});

function handlerSource(file: string, names: string[]) {
  const source = readFileSync(new URL(`../../../src/app/orders/${file}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: string[] = [];
  function collect(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) handlers.push(node.getText(tree));
    ts.forEachChild(node, collect);
  }
  collect(tree); expect(handlers).toHaveLength(names.length);
  return ts.transpileModule(handlers.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

it.each([
  { body: {}, expectedStatus: undefined },
  { body: null, expectedStatus: undefined },
  { body: { status: "not-an-order-status" }, expectedStatus: undefined },
  { body: { status: "in_production" }, expectedStatus: "in_production" },
])("a saved row refreshes with validated status $expectedStatus when sessionStorage is blocked", async ({ body, expectedStatus }) => {
  const window = Object.defineProperty({}, "sessionStorage", { get() { throw new Error("storage blocked"); } });
  vi.stubGlobal("window", window);
  const { invalidateClientCache } = await import("@/lib/clientCache");
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => body }));
  const onSaved = vi.fn(async () => undefined), notices: string[] = [];
  const context = createContext({
    drafts: { 1: { totalQty: "200" }, 2: { deliveryDate: "2026-12-01" } }, editingDisabled: false,
    ORDER_STATUSES, invalidateClientCache, apiFetch, onSaved, setSavingId: () => undefined,
    setNotice: (s: string) => notices.push(s),
    setDrafts: (update: (drafts: unknown) => unknown) => { context.drafts = update(context.drafts); },
  });
  runInContext(handlerSource("OrdersTable.tsx", ["saveRow"]), context);
  await runInContext('saveRow({ id:1, totalQty:100, demandQty:100, externalOrderNo:"PO-1" })', context);
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(onSaved).toHaveBeenCalledWith(1, { totalQty: 200 }, expectedStatus);
  expect(context.drafts).toEqual({ 2: { deliveryDate: "2026-12-01" } });
  expect(notices.at(-1)).toBe("订单「PO-1」已保存");
});

it.each(["in_production", undefined])("refresh applies only the saved row status %s before totals are derived", async status => {
  const rows = [
    { id: 1, status: "completed", totalQty: 100, deliveryDate: "2026-11-01", remainingQty: 0 },
    { id: 2, status: "scheduled", totalQty: 100, deliveryDate: "2026-11-02", remainingQty: 50 },
  ];
  const apiFetch = vi.fn(async () => ({ ok: true, json: async () => [
    { id: 1, scheduled: true, demandQty: 200, remainingQty: 180, inProductionRemainingQty: 180 },
    { id: 2, scheduled: true, demandQty: 100, remainingQty: 50, inProductionRemainingQty: 50 },
  ] }));
  const context = createContext({ rows, apiFetch, today: "2026-10-26", revision: { current: 0 },
    setRows: (update: (value: unknown) => unknown) => { context.rows = update(context.rows); } });
  runInContext(handlerSource("OrdersDataLoader.tsx", ["enrich", "onSaved"]), context);
  await runInContext(`onSaved(1, { totalQty: 200 }, ${JSON.stringify(status)})`, context);
  expect(context.rows[0].status).toBe(status ?? "completed");
  expect(context.rows[0].totalQty).toBe(200);
  expect(context.rows[1].status).toBe("scheduled");
  expect(context.rows[1].totalQty).toBe(100);
  expect(inProductionQuantity(context.rows)).toBe(status ? 230 : 50);
});

it("available storage invalidates only the requested cache prefix", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
    get length() { return values.size; }, key: (index: number) => Array.from(values.keys())[index], removeItem: (key: string) => values.delete(key) };
  vi.stubGlobal("window", { sessionStorage: storage });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  const { cachedJson, invalidateClientCache } = await import("@/lib/clientCache");
  await cachedJson("/api/orders/overview", 60_000); await cachedJson("/api/settings", 60_000);
  invalidateClientCache("/api/orders");
  expect(values.has("sprayplan:/api/orders/overview")).toBe(false);
  expect(values.has("sprayplan:/api/settings")).toBe(true);
});
