const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Execute the actual TypeScript helpers, React event handlers and Next proxies.
// All requests are synthetic in-memory responses; no server/configuration is read.
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const transpile = value => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const json = value => JSON.parse(JSON.stringify(value));
class FakeNextResponse extends Response {
  static json(value, options) { return new FakeNextResponse(JSON.stringify(value), { ...options, headers: { "content-type": "application/json", ...options?.headers } }); }
}
function moduleAt(file, extra = {}, dependencies = {}) {
  const context = {
    exports: {}, process: { env: { VOYAGEPLEX_API_BASE_URL: "http://synthetic.invalid:5088" } },
    Headers, Request, Response, URL, AbortController, Error, TypeError,
    require: name => {
      if (name === "next/server") return { NextResponse: FakeNextResponse };
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected test dependency: ${name}`);
    }, ...extra,
  };
  vm.runInNewContext(transpile(source(file)), context, { filename: file });
  return context.exports;
}
const helpers = moduleAt("lib/mail-recovery.ts");
const tree = ts.createSourceFile("mail-recovery.tsx", source("components/mail-recovery.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(ast, predicate) {
  let found;
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found, "expected actual source node"); return found;
}
function actualHandler(name) {
  const node = findNode(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return transpile(node.getText(tree));
}
function actualLoad() {
  const node = findNode(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === "load");
  assert.ok(ts.isCallExpression(node.initializer));
  return transpile(`globalThis.load = ${node.initializer.arguments[0].getText(tree)};`);
}
const mail = (id, canRetry = true) => ({ id, mailSubject: `Synthetic ${id}`, mailReceivedAt: "2026-11-07T02:00:00Z", mailboxUid: 1000 + id, canRetry, reason: "" });
const listing = (overrides = {}) => ({ company: "Xingxin", ownerId: null, address: "test@example.invalid", page: 1, pageSize: 20, total: 3, items: [mail(1), mail(2), mail(3, false)], ...overrides });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(extra = {}, realLoad = false) {
  const changes = [], requests = [], timers = new Map(); let timerId = 0;
  const context = {
    ...helpers, data: listing(), selected: [1, 2], confirming: true, denied: false, loading: false, working: false, error: "", results: [],
    busy: { current: false }, mounted: { current: true }, request: { current: null }, resultScope: { current: null },
    document: { cookie: "voyageplex_company=Xingxin" }, basePath: "/voyageplex", AbortController, Error, TypeError,
    window: { setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) },
    load: async (...args) => { changes.push(["load", ...args]); },
    fetch: async (url, init) => { requests.push([url, init]); return Response.json({ requested: 2, recovered: 1, stillFailed: 1, recoveredItemIds: [1] }); },
    ...extra,
  };
  for (const name of ["data", "selected", "working", "confirming", "error", "results", "denied", "loading"]) {
    context[`set${name[0].toUpperCase()}${name.slice(1)}`] = value => {
      context[name] = typeof value === "function" ? value(context[name]) : value;
      changes.push([name, context[name]]);
    };
  }
  vm.createContext(context);
  vm.runInContext(actualHandler("retry") + actualHandler("choose") + (realLoad ? actualLoad() : ""), context);
  return { context, changes, requests, timers, retry: () => context.retry(), load: (...args) => context.load(...args) };
}

test("mailbox scope uses one selected Huadeng owner and never carries it into Xingxin", () => {
  assert.deepEqual(json(helpers.readMailScope("voyageplex_company=Huadeng; voyageplex_mail_owner=12")), { company: "Huadeng", ownerId: 12 });
  for (const owner of ["", "0", "-1", "1.5", "NaN", "9007199254740992"]) {
    assert.equal(helpers.readMailScope(`voyageplex_company=Huadeng; voyageplex_mail_owner=${owner}`).ownerId, null);
  }
  assert.deepEqual(json(helpers.readMailScope("voyageplex_company=Xingxin; voyageplex_mail_owner=12")), { company: "Xingxin", ownerId: null });
  assert.equal(helpers.sameMailScope({ company: "Huadeng", ownerId: 12 }, { company: "Huadeng", ownerId: 13 }), false);
});

test("selection is limited to one to five distinct, currently retryable records", () => {
  const items = Array.from({ length: 7 }, (_, i) => mail(i + 1, i !== 6));
  for (const ids of [[], [1, 1], [1, 2, 3, 4, 5, 6], [7], [8]]) assert.throws(() => helpers.recoverySelection(items, ids));
  assert.deepEqual(json(helpers.recoverySelection(items, [5, 1])).map(item => item.id), [5, 1]);
});

test("200 result requires exact selected IDs and internally consistent counts", () => {
  const selected = [mail(1), mail(2)];
  const valid = { requested: 2, recovered: 1, stillFailed: 1, recoveredItemIds: [1] };
  assert.deepEqual(json(helpers.recoveryResults(selected, valid)).map(item => item.outcome), ["recovered", "failed"]);
  for (const invalid of [null, {}, [], { ...valid, requested: "2" }, { ...valid, recovered: 2 }, { ...valid, stillFailed: 0 },
    { ...valid, recoveredItemIds: [3] }, { ...valid, recoveredItemIds: ["1"] }, { ...valid, recoveredItemIds: [1, 1] }, { ...valid, recoveredItemIds: [1.5] }]) {
    assert.throws(() => helpers.recoveryResults(selected, invalid));
  }
  assert.deepEqual(json(helpers.recoveryResults(selected, { requested: 2, recovered: 0, stillFailed: 2, recoveredItemIds: [] })).map(item => item.outcome), ["failed", "failed"]);
});

test("actual retry sends exactly selected IDs once and never starts sync/backfill/tasks", async () => {
  const h = harness(); await h.retry();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], "/voyageplex/api/imports/email/mailbox/retry-failed");
  assert.equal(h.requests[0][1].method, "POST");
  assert.deepEqual(JSON.parse(h.requests[0][1].body), { itemIds: [1, 2] });
  assert.deepEqual(json(h.context.results).map(item => item.outcome), ["recovered", "failed"]);
  assert.ok(h.changes.some(row => row[0] === "load"));
  assert.equal(h.context.busy.current, false); assert.equal(h.timers.size, 0);
});

test("confirmation cancellation, unavailable data and denied access send no POST", async () => {
  for (const extra of [{ confirming: false }, { denied: true }, { data: undefined }, { busy: { current: true } }]) {
    const h = harness(extra); await h.retry(); assert.equal(h.requests.length, 0);
  }
});

test("duplicate checkbox events stay distinct and a stale selection is handled without POST", async () => {
  const h = harness({ selected: [] });
  h.context.choose(1, true); h.context.choose(1, true); h.context.choose(2, true);
  assert.deepEqual(json(h.context.selected), [1, 2]);
  h.context.selected = [1, 999]; h.context.confirming = true;
  await h.retry(); assert.equal(h.requests.length, 0); assert.equal(h.context.confirming, false); assert.equal(h.context.selected.length, 0); assert.ok(h.context.error);
});

test("a second click while the first request is pending cannot duplicate the POST", async () => {
  const pending = deferred(); let count = 0;
  const h = harness({ fetch: async () => { count++; return pending.promise; } });
  const first = h.retry(); h.context.confirming = true; await h.retry(); assert.equal(count, 1);
  pending.resolve(Response.json({ requested: 2, recovered: 2, stillFailed: 0, recoveredItemIds: [1, 2] })); await first;
  assert.equal(count, 1); assert.equal(h.context.busy.current, false);
});

test("scope change before submit clears selection without a request", async () => {
  const h = harness({ document: { cookie: "voyageplex_company=Huadeng; voyageplex_mail_owner=12" } });
  await h.retry(); assert.equal(h.requests.length, 0); assert.equal(h.context.data, undefined); assert.equal(h.context.selected.length, 0);
  assert.match(h.context.error, /邮箱已变化/);
});

test("scope change while POST is pending does not attribute its response to another mailbox", async () => {
  const pending = deferred();
  const h = harness({ fetch: () => pending.promise }); const run = h.retry();
  h.context.document.cookie = "voyageplex_company=Huadeng; voyageplex_mail_owner=12";
  pending.resolve(Response.json({ requested: 2, recovered: 2, stillFailed: 0, recoveredItemIds: [1, 2] })); await run;
  assert.equal(h.context.data, undefined); assert.equal(h.context.results.length, 0); assert.match(h.context.error, /邮箱已变化/);
});

test("scope change during response JSON read cannot render stale-mailbox recovery results", async () => {
  const body = deferred(); const entered = deferred();
  const h = harness({ fetch: async () => ({ ok: true, status: 200, json: () => { entered.resolve(); return body.promise; } }) });
  const run = h.retry(); await entered.promise;
  h.context.document.cookie = "voyageplex_company=Huadeng; voyageplex_mail_owner=12";
  body.resolve({ requested: 2, recovered: 2, stillFailed: 0, recoveredItemIds: [1, 2] }); await run;
  assert.equal(h.context.results.length, 0); assert.equal(h.context.data, undefined); assert.match(h.context.error, /邮箱已变化/);
});

test("401 and 403 invalidate action access and do not auto-resubmit or leak backend text", async () => {
  for (const status of [401, 403]) {
    let count = 0;
    const h = harness({ fetch: async () => { count++; return Response.json({ error: "SECRET_TEST_SENTINEL" }, { status }); } });
    await h.retry(); assert.equal(count, 1); assert.equal(h.context.denied, true); assert.equal(h.context.data, undefined);
    assert.doesNotMatch(h.context.error, /SECRET_TEST_SENTINEL/); assert.match(h.context.error, /管理员|登录/);
  }
});

test("conflict, rate limit, gateway failure and malformed 200 leave result unknown without replay", async () => {
  for (const response of [Response.json({}, { status: 409 }), Response.json({}, { status: 429 }), Response.json({}, { status: 502 }), Response.json({ requested: 2 }), new Response("not-json")]) {
    let count = 0; const h = harness({ fetch: async () => { count++; return response; } });
    await h.retry(); assert.equal(count, 1); assert.equal(h.context.data, undefined); assert.equal(h.context.results.length, 0); assert.ok(h.context.error);
  }
});

test("network disconnect sends one request only and requires a fresh list", async () => {
  let count = 0; const h = harness({ fetch: async () => { count++; throw new TypeError("Synthetic disconnect"); } });
  await h.retry(); assert.equal(count, 1); assert.equal(h.context.data, undefined); assert.equal(h.context.busy.current, false); assert.equal(h.context.results.length, 0);
});

test("actual timeout aborts the request but does not claim the server rolled back", async () => {
  let count = 0;
  const h = harness({ fetch: (_url, options) => { count++; return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })); } });
  const run = h.retry(); for (const expire of h.timers.values()) expire(); await run;
  assert.equal(count, 1); assert.match(h.context.error, /尚未确认/); assert.equal(h.context.data, undefined); assert.equal(h.context.results.length, 0);
});

test("unmounted retry response does not update UI state or reload", async () => {
  const pending = deferred(); const h = harness({ fetch: () => pending.promise }); const run = h.retry();
  h.context.mounted.current = false; const before = h.changes.length;
  pending.resolve(Response.json({ requested: 2, recovered: 2, stillFailed: 0, recoveredItemIds: [1, 2] })); await run;
  assert.equal(h.changes.length, before); assert.equal(h.context.busy.current, false);
});

test("Huadeng all-personnel view makes no failed-list request", async () => {
  const h = harness({ document: { cookie: "voyageplex_company=Huadeng" } }, true);
  await h.load(); assert.equal(h.requests.length, 0); assert.equal(h.context.loading, false); assert.match(h.context.error, /选择一位/);
});

test("actual list load rejects another owner's response and aborts an older list request", async () => {
  const previous = new AbortController();
  const h = harness({ request: { current: previous }, fetch: async () => Response.json(listing({ company: "Huadeng", ownerId: 12 })) }, true);
  await h.load(); assert.equal(previous.signal.aborted, true); assert.equal(h.context.data, undefined); assert.match(h.context.error, /邮箱已变化/);
});

test("a valid selected-mailbox list is accepted and clears a prior auth denial", async () => {
  const h = harness({ denied: true, fetch: async () => Response.json(listing()) }, true);
  await h.load(); assert.deepEqual(json(h.context.data), listing()); assert.equal(h.context.denied, false); assert.equal(h.context.error, "");
});

test("loading a changed mailbox clears prior recovery results without submitting anything", async () => {
  const scope = { company: "Xingxin", ownerId: null };
  const h = harness({ resultScope: { current: scope }, results: [{ id: 1, subject: "Synthetic", outcome: "recovered" }],
    document: { cookie: "voyageplex_company=Huadeng; voyageplex_mail_owner=12" },
    fetch: async () => Response.json(listing({ company: "Huadeng", ownerId: 12 })) }, true);
  await h.load(); assert.equal(h.context.results.length, 0); assert.equal(h.context.data.ownerId, 12);
});

test("a superseded list's late 401 cannot clear a newer successful mailbox list", async () => {
  const pending = deferred(); let count = 0;
  const h = harness({ fetch: () => ++count === 1 ? pending.promise : Promise.resolve(Response.json(listing())) }, true);
  const old = h.load(); await h.load(); pending.resolve(Response.json({}, { status: 401 })); await old;
  assert.deepEqual(json(h.context.data), listing()); assert.equal(h.context.denied, false); assert.equal(h.context.error, "");
});

test("actual list requires bounded pagination and valid metadata rather than trusting a 200", async () => {
  for (const value of [listing({ pageSize: 50 }), listing({ total: -1 }), listing({ page: 2 }), listing({ items: [mail(1), mail(1)] }), listing({ items: [{ ...mail(1), id: -1 }] }), listing({ items: [{ ...mail(1), canRetry: "true" }] })]) {
    const h = harness({ fetch: async () => Response.json(value) }, true); await h.load();
    assert.equal(h.context.data, undefined); assert.ok(h.context.error);
  }
});

test("real app navigation permits the recovery tab only for admin", () => {
  const file = source("components/app-shell.tsx"); const ast = ts.createSourceFile("app-shell.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sections = findNode(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "mailSections").initializer;
  const workspace = findNode(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === "MailWorkspace");
  const available = findNode(workspace, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "available").initializer;
  for (const role of ["admin", "supervisor", "shipping", "warehouse"]) {
    const context = { role, Inbox: 0, ContactRound: 0, Settings: 0, History: 0 };
    const keys = vm.runInNewContext(transpile(`const mailSections = ${sections.getText(ast)}; ${available.getText(ast)}.map(value=>value.key);`), context);
    assert.equal(keys.includes("recovery"), role === "admin");
    if (role === "supervisor") assert.ok(keys.includes("settings"), "existing supervisor settings permission stays unchanged");
  }
});

function routeHarness(name, fetcher) {
  const seen = []; const upstream = async (...args) => { seen.push(args); return fetcher ? fetcher(...args) : Response.json({ ok: true }); };
  const backend = moduleAt("lib/backend-proxy.ts", { fetch: upstream });
  const route = moduleAt(`app/api/imports/email/mailbox/${name}/route.ts`, {}, { "@/lib/backend-proxy": backend });
  return { route, seen };
}
function incoming(body, page = "1") {
  const controller = new AbortController();
  return { headers: new Headers({ cookie: "voyageplex_session=synthetic; voyageplex_company=Huadeng; voyageplex_mail_owner=12" }), signal: controller.signal, nextUrl: new URL(`http://synthetic.invalid/api?page=${encodeURIComponent(page)}`), json: async () => body };
}

test("actual Next POST and backend proxy preserve cookie/signal and strip unexpected mutation fields", async () => {
  const h = routeHarness("retry-failed"); const req = incoming({ itemIds: [17, 19], capturedLastUid: 99999, ownerId: 88, sync: true });
  const response = await h.route.POST(req);
  assert.equal(response.status, 200); assert.equal(h.seen.length, 1);
  const [url, init] = h.seen[0]; assert.equal(url, "http://synthetic.invalid:5088/api/imports/email/mailbox/retry-failed");
  assert.equal(init.signal, req.signal); assert.equal(init.headers.get("cookie"), req.headers.get("cookie")); assert.equal(init.cache, "no-store");
  assert.deepEqual(JSON.parse(init.body), { itemIds: [17, 19] }); assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("Next POST validates ID count/type/distinctness before any upstream request", async () => {
  for (const body of [null, [], {}, { itemIds: [] }, { itemIds: [1, 1] }, { itemIds: [1, 2, 3, 4, 5, 6] }, { itemIds: [-1] }, { itemIds: [0] }, { itemIds: ["1"] }, { itemIds: [true] }, { itemIds: [1.5] }, { itemIds: [Number.MAX_SAFE_INTEGER + 1] }]) {
    const h = routeHarness("retry-failed"); assert.equal((await h.route.POST(incoming(body))).status, 400); assert.equal(h.seen.length, 0);
  }
  const h = routeHarness("retry-failed"); const req = incoming(null); req.json = async () => { throw new Error("bad json"); };
  assert.equal((await h.route.POST(req)).status, 400); assert.equal(h.seen.length, 0);
});

test("Next GET validates page and forwards exact scope cookies and cancellation", async () => {
  const h = routeHarness("failed"); const req = incoming(undefined, "2"); const response = await h.route.GET(req);
  assert.equal(response.status, 200); assert.equal(h.seen[0][0], "http://synthetic.invalid:5088/api/imports/email/mailbox/failed?page=2");
  assert.equal(h.seen[0][1].signal, req.signal); assert.equal(h.seen[0][1].headers.get("cookie"), req.headers.get("cookie"));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  for (const page of ["0", "-1", "1.5", "01", "1&company=Xingxin", "10000000"]) {
    const invalid = routeHarness("failed"); assert.equal((await invalid.route.GET(incoming(null, page))).status, 400); assert.equal(invalid.seen.length, 0);
  }
});

test("both actual Next proxies preserve auth/conflict failures and do not replay upstream errors", async () => {
  for (const name of ["failed", "retry-failed"]) {
    for (const status of [401, 403, 409, 429, 504]) {
      const h = routeHarness(name, async () => Response.json({ error: "safe fixed error" }, { status }));
      const response = await h.route[name === "failed" ? "GET" : "POST"](incoming({ itemIds: [17] }));
      assert.equal(response.status, status); assert.equal(h.seen.length, 1); assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    const h = routeHarness(name, async () => { throw new Error("SYNTHETIC_PRIVATE_DETAIL"); });
    const response = await h.route[name === "failed" ? "GET" : "POST"](incoming({ itemIds: [17] }));
    assert.equal(response.status, 502); assert.equal(h.seen.length, 1); assert.doesNotMatch(await response.text(), /SYNTHETIC_PRIVATE_DETAIL/);
  }
});
