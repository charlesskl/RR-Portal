const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "components/daily-mail-workbench.tsx"), "utf8");
const tree = ts.createSourceFile("workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `actual ${name} handler`);
  return ts.transpileModule(found.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function handler(name, extras = {}) {
  const changes = [], requests = [];
  const context = {
    detail: { id: 44188, canRestoreReview: true, reviewVersion: "a".repeat(64), workCategory: "Change" },
    working: false, dirty: false,
    result: { items: [] },
    window: { prompt: () => "Correction requested", confirm: () => true },
    setWorking: value => changes.push(["working", value]),
    setError: value => changes.push(["error", value]),
    setNotice: value => changes.push(["notice", value]),
    setSelected: () => changes.push(["selectionCleared"]),
    setRefresh: callback => changes.push(["refresh", callback(3)]),
    taskFetch: async (url, init) => { requests.push([url, init]); return new Response("{}", { status: 200 }); },
    Response, Set, Promise, ...extras,
  };
  vm.createContext(context);
  vm.runInContext(actualFunction("readResponse") + actualFunction(name), context);
  return { context, changes, requests, run: (...args) => context[name](...args) };
}

test("cancelling recovery creates no request or draft changes", async () => {
  const h = handler("restoreReview", { window: { prompt: () => null } });
  await h.run();
  assert.equal(h.requests.length, 0);
  assert.equal(h.changes.length, 0);
  assert.equal(h.context.detail.workCategory, "Change");
});
test("recovery sends only selected mail/version/reason and never confirms automatically", async () => {
  const h = handler("restoreReview");
  await h.run();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], "/api/mail/candidates/44188/restore-review");
  assert.deepEqual(JSON.parse(h.requests[0][1].body), { expectedReviewVersion: "a".repeat(64), reason: "Correction requested" });
  assert.ok(h.changes.some(row => row[0] === "refresh" && row[1] === 4));
  assert.equal(h.context.detail.workCategory, "Change");
});
test("stale recovery response preserves detail and reports the server conflict", async () => {
  const h = handler("restoreReview", { taskFetch: async () => new Response(JSON.stringify({ error: "Refresh this mail" }), { status: 409 }) });
  await h.run();
  assert.ok(h.changes.some(row => row[0] === "error" && row[1] === "Refresh this mail"));
  assert.ok(!h.changes.some(row => row[0] === "refresh"));
  assert.equal(h.context.detail.reviewVersion, "a".repeat(64));
});
test("NoTask acknowledgement asks explicitly and cancellation sends no state update", async () => {
  let wording;
  const h = handler("act", { window: { confirm: text => { wording = text; return false; } } });
  await h.run("acknowledge", [44188]);
  assert.match(wording, /不会建立任务/);
  assert.match(wording, /不会把邮件中的变更写入已有任务/);
  assert.equal(h.requests.length, 0);
});
test("single-mail Next proxy forwards recovery CAS and owner-confirmation body unchanged", async () => {
  const route = fs.readFileSync(path.join(root, "app/api/mail/candidates/[itemId]/[action]/route.ts"), "utf8");
  const routeTree = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = routeTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
  const code = ts.transpileModule(node.getText(routeTree).replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const seen = [];
  const env = {
    backendFetch: async (...args) => { seen.push(args); return { status: 200 }; },
    proxyResponse: value => value,
    NextResponse: { json: () => { throw Error("unexpected proxy failure"); } },
  };
  vm.createContext(env); vm.runInContext(code, env);
  const body = JSON.stringify({ expectedReviewVersion: "a".repeat(64), reason: "user reason", ownerConfirmations: { 13: 2 } });
  const req = { text: async () => body };
  await env.POST(req, { params: Promise.resolve({ itemId: "44188", action: "restore-review" }) });
  assert.equal(seen[0][1], "/api/mail/candidates/44188/restore-review");
  assert.equal(seen[0][2].body, body);
  assert.equal(seen[0][2].headers["content-type"], "application/json");
  await env.POST({ text: async () => "" }, { params: Promise.resolve({ itemId: "44188", action: "confirm" }) });
  assert.equal(seen[1][2].body, undefined, "legacy body-less actions stay body-less");
});
