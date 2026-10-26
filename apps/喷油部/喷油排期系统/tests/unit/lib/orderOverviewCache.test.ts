import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

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

it("a blocked sessionStorage getter does not prevent the actual saved-row refresh or draft cleanup", async () => {
  const window = Object.defineProperty({}, "sessionStorage", { get() { throw new Error("storage blocked"); } });
  vi.stubGlobal("window", window);
  const { invalidateClientCache } = await import("@/lib/clientCache");
  const page = readFileSync(new URL("../../../src/app/orders/OrdersTable.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("OrdersTable.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler = "";
  function collect(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "saveRow") handler = node.getText(tree);
    ts.forEachChild(node, collect);
  }
  collect(tree); expect(handler).not.toBe("");
  const apiFetch = vi.fn(async () => ({ ok: true }));
  const onSaved = vi.fn(async () => undefined), notices: string[] = [];
  const context = createContext({
    drafts: { 1: { totalQty: "200" }, 2: { deliveryDate: "2026-12-01" } }, editingDisabled: false,
    invalidateClientCache, apiFetch, onSaved, setSavingId: () => undefined,
    setNotice: (s: string) => notices.push(s),
    setDrafts: (update: (drafts: unknown) => unknown) => { context.drafts = update(context.drafts); },
  });
  runInContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await runInContext('saveRow({ id:1, totalQty:100, demandQty:100, externalOrderNo:"PO-1" })', context);
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(onSaved).toHaveBeenCalledWith(1, { totalQty: 200 });
  expect(context.drafts).toEqual({ 2: { deliveryDate: "2026-12-01" } });
  expect(notices.at(-1)).toBe("订单「PO-1」已保存");
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
