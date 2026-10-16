const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../frontend', name), 'utf8');
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
const report = note => ({ rows: [{ id: 1, customer: 'A', confirmation: { status: 'pending', workshops: [], note } }], workshops: [], summary_columns: [], can_edit: true });

function summaryFixture(testApi) {
  const elements = new Map(), alerts = [], handlers = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', style: {}, innerHTML: '', addEventListener() {}, closest: () => ({ style: {} }), querySelectorAll: () => [] });
    return elements.get(id);
  };
  const context = { document: { getElementById: element, querySelectorAll: () => [] }, window: { addEventListener: (event, fn) => { handlers[event] = fn; } }, alert: message => alerts.push(message), testApi };
  const source = read('summary.js').split("$('summary-customer').onchange = render;")[0];
  vm.runInNewContext(source + '\napi = testApi; this.app = { state, saveRow, load, rowHtml, render };', context);
  const fields = { '.summary-note': { value: 'new' }, '.summary-price': { value: '0' }, '.summary-qty': { value: '' }, '.summary-workshop': { value: '' }, '.save-summary': {} };
  const tr = { dataset: { id: '1' }, querySelector: selector => fields[selector] || null };
  context.app.state.rows = report('old').rows;
  return { ...context.app, tr, fields, alerts, handlers };
}

test('acknowledged summary values survive refresh failure and filter redraw without becoming unsaved', async () => {
  const f = summaryFixture(async (_url, options) => { if (options) return { ok: true }; throw Error('502'); });
  await f.saveRow(f.tr);
  assert.equal(f.state.drafts.size, 0);
  assert.equal(f.state.saved.get('1').note, 'new');
  assert.match(f.rowHtml(f.state.rows[0], 1), /value="new"/);
  assert.match(f.alerts[0], /本行已保存/);
  const event = { preventDefault() { this.prevented = true; } };
  f.handlers.beforeunload(event);
  assert.equal(event.prevented, undefined);
});

test('summary discards an older snapshot arriving after a newer refresh', async () => {
  const older = deferred(), newer = deferred(); let reads = 0;
  const f = summaryFixture(() => (++reads === 1 ? older.promise : newer.promise));
  const first = f.load(false), second = f.load(false);
  newer.resolve(report('newer')); await second;
  older.resolve(report('older')); await first;
  assert.equal(f.state.rows[0].confirmation.note, 'newer');
});

test('summary snapshots started before a successful save cannot clear acknowledged values', async () => {
  const oldRead = deferred(), savedRead = deferred(); let reads = 0;
  const f = summaryFixture((_url, options) => options ? Promise.resolve({ ok: true }) : (++reads === 1 ? oldRead.promise : savedRead.promise));
  const oldLoad = f.load(false);
  const saving = f.saveRow(f.tr);
  await Promise.resolve();
  oldRead.resolve(report('old')); await oldLoad;
  assert.equal(f.state.saved.get('1').note, 'new');
  savedRead.resolve(report('new')); await saving;
  assert.equal(f.state.saved.size, 0);
  assert.equal(f.state.rows[0].confirmation.note, 'new');
});

test('obsolete summary refresh errors do not report failure for the latest successful snapshot', async () => {
  let rejectOld; const old = new Promise((_resolve, reject) => { rejectOld = reject; }); let reads = 0;
  const f = summaryFixture(() => ++reads === 1 ? old : Promise.resolve(report('latest')));
  const first = f.load(false); await f.load(false); rejectOld(Error('old request failed'));
  assert.equal(await first, false);
  assert.equal(f.state.rows[0].confirmation.note, 'latest');
});

function task(quoteId = 1, versionId = 11) {
  return { quote: { id: quoteId }, selected_version: { id: versionId, status: 'drafting' }, versions: [{ id: versionId }], sections: [{ id: 111, dept: 'assembly', dept_name: '装配部', payload_json: '{"value":1}', revision: 'old-revision', can_edit: true, status: 'empty' }] };
}

function verificationFixture(testApi) {
  const elements = new Map(), alerts = [], calls = [], handlers = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, { disabled: false, inert: false, isConnected: true, style: {}, innerHTML: '', contains: () => false, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const controls = [element('verification-save-draft'), element('verification-submit'), element('disabled-control')];
  controls[2].disabled = true;
  element('verification-detail').querySelectorAll = () => controls;
  const context = {
    document: { getElementById: element },
    window: { VerificationWorkbench: { renderAssembly(_body, _draft, _editable, onChange) { calls.push(onChange); } }, addEventListener: (event, fn) => { handlers[event] = fn; } },
    alert: message => alerts.push(message), confirm: () => true, testApi, initialTask: task(),
  };
  const source = read('verification.js').split("$('verification-search').oninput =")[0];
  vm.runInNewContext(source + `
    api = testApi; me = {dept:'assembly',role:'admin'}; taskState = initialTask; activeDepartment = 'assembly'; sectionDirty = true;
    let rendered = 0; renderDetail = () => { rendered += 1; };
    this.app = { renderDepartmentWorkbench, fetchTask, switchVersion, selectTask,
      getTask: () => taskState, setTask: value => {taskState = value;}, dirty: () => sectionDirty,
      pending: () => sectionSavePending, rendered: () => rendered };
  `, context);
  context.app.renderDepartmentWorkbench();
  return { ...context.app, element, alerts, calls, controls, handlers };
}

test('verification save locks navigation, prevents duplicate writes, and restores existing disabled states on error', async () => {
  const gate = deferred(); let writes = 0;
  const f = verificationFixture(async (_url, options) => { if (options) { writes++; await gate.promise; throw Error('409 conflict'); } throw Error('unexpected navigation'); });
  const saving = f.element('verification-save-draft').onclick();
  assert.equal(f.element('verification-workbench-body').inert, true);
  assert.ok(f.controls.every(control => control.disabled));
  await f.element('verification-submit').onclick();
  await f.switchVersion(12); await f.selectTask(2);
  assert.equal(writes, 1);
  gate.resolve(); await saving;
  assert.equal(f.dirty(), true);
  assert.equal(f.element('verification-workbench-body').inert, false);
  assert.equal(f.controls[0].disabled, false);
  assert.equal(f.controls[2].disabled, true);
  assert.match(f.alerts[0], /409/);
});

test('verification retains a successful revision after refresh failure for the next save', async () => {
  const submissions = [];
  const f = verificationFixture(async (_url, options) => {
    if (!options) throw Error('502 refresh');
    submissions.push(JSON.parse(options.body));
    return { ok: true, revision: 'saved-revision', section_status: 'filled', filled_at: '2026-10-16 01:02:03.123456' };
  });
  await f.element('verification-save-draft').onclick();
  assert.equal(f.getTask().sections[0].revision, 'saved-revision');
  assert.equal(f.dirty(), false);
  assert.equal(f.getTask().sections[0]._draft.value, 1);
  assert.match(f.alerts[0], /本部门已保存/);
  await f.element('verification-save-draft').onclick();
  assert.equal(submissions[1].base_revision, 'saved-revision');
});

test('verification refresh is bound to the saved task and cannot replace a newer task', async () => {
  const gate = deferred(), reads = [];
  const f = verificationFixture(async (url, options) => {
    if (options) { await gate.promise; return { ok: true, revision: 'new' }; }
    reads.push(url); return task();
  });
  const saving = f.element('verification-save-draft').onclick();
  f.setTask(task(2, 21)); gate.resolve(); await saving;
  assert.deepEqual(reads, ['/verifications/1?version_id=11']);
  assert.equal(f.getTask().quote.id, 2);
  assert.equal(f.rendered(), 0);
});

test('verification refuses mismatched task responses and missing save revisions', async () => {
  let writes = 0;
  const f = verificationFixture(async (_url, options) => { if (options) writes++; return task(2, 21); });
  await assert.rejects(f.fetchTask(1, 11), /任务或版本不匹配/);
  f.getTask().sections[0].revision = null;
  await f.element('verification-save-draft').onclick();
  assert.equal(writes, 0);
  assert.match(f.alerts[0], /服务版本未同步/);
});
