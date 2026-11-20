'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');

function browser({ fail = false, permissions = ['reviewRecord', 'deleteRecord'] } = {}) {
  const messages = [], writes = [], store = new Map(), wrap = { innerHTML: '', querySelector: () => null };
  const ctx = { console, setTimeout() {}, clearTimeout() {}, setInterval() {}, addEventListener() {},
    location: { pathname: '/qc/' }, navigator: {}, confirm: () => true,
    document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => id === 'reviewTableWrap' ? wrap : null },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => {
      if (fail) throw new Error('QuotaExceededError'); store.set(key, value); writes.push(JSON.parse(value));
    }, removeItem: key => store.delete(key) },
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source('app.js'), ctx);
  ctx.can = action => permissions.includes(action);
  ctx._liveUser = () => ({ username: 'reviewer', name: 'Reviewer' });
  ctx.nowIso = () => '2026-10-31T03:00:00.000Z';
  ctx.showToast = (message, type) => messages.push({ message, type });
  ctx.updateTopKpis = () => {};
  const run = text => vm.runInContext(text, ctx);
  const json = text => JSON.parse(run('JSON.stringify(' + text + ')'));
  const records = [
    { id: 1, productNo: 'one', status: 'pending', updatedAt: '2026-01-01', rejectReason: 'old' },
    { id: 2, productNo: 'two', status: 'pending', updatedAt: '2026-01-02', resubmitted: true },
    { id: 3, productNo: 'three', status: 'approved', reviewBy: 'Original', updatedAt: '2026-01-03' },
    { id: 4, productNo: 'four', status: 'rejected', rejectReason: 'repair', updatedAt: '2026-01-04' },
  ];
  run('state=' + JSON.stringify({ records, nextId: 5 }) + ';_reviewSelected=new Set([1,2]);');
  return { ctx, run, json, records, messages, writes, wrap };
}

test('batch approval stages only current-tab selections and preserves all business fields', () => {
  const b = browser(); b.run('_reviewSelected.add(4);batchApproveSelected()');
  const after = b.json('state.records');
  assert.deepEqual(after.slice(0, 2).map(r => [r.id, r.productNo, r.status, r.reviewBy, r.reviewAt, r.rejectReason]),
    [[1,'one','approved','Reviewer','2026-10-31T03:00:00.000Z',''],[2,'two','approved','Reviewer','2026-10-31T03:00:00.000Z','']]);
  assert.equal(Object.hasOwn(after[1], 'resubmitted'), false);
  assert.deepEqual(after.slice(2), b.records.slice(2));
  assert.equal(b.writes.length, 1); assert.equal(b.json('_reviewSelected.size'), 0);
  assert.equal(b.messages.at(-1).type, 'info'); assert.match(b.messages.at(-1).message, /等待服务器同步/);
});
test('failed local approval retains original records and selection without claiming success', () => {
  const b = browser({ fail: true }); b.run('batchApproveSelected()');
  assert.deepEqual(b.json('state.records'), b.records);
  assert.deepEqual(b.json('[..._reviewSelected]'), [1,2]);
  assert.equal(b.messages.at(-1).type, 'error'); assert.equal(b.writes.length, 0);
});
test('failed local deletion restores records and rolls back only its own pending-delete marks', () => {
  const b = browser({ fail: true }), marked = [];
  b.ctx.__QC_MARK_DELETED = ids => { marked.push(...ids); return () => marked.splice(0); };
  b.run('batchDeleteSelected()');
  assert.deepEqual(b.json('state.records'), b.records); assert.deepEqual(marked, []);
  assert.deepEqual(b.json('[..._reviewSelected]'), [1,2]); assert.equal(b.messages.at(-1).type, 'error');
});
test('deletion marks the real current-tab targets before persistence and retains other statuses', () => {
  const b = browser(), marked = []; b.ctx.__QC_MARK_DELETED = ids => { marked.push(...ids); };
  b.run('_reviewSelected.add(3);_reviewSelected.add(99);batchDeleteSelected()');
  assert.deepEqual(marked, [1,2]); assert.deepEqual(b.json('state.records'), b.records.slice(2));
  assert.equal(b.writes.length, 1); assert.match(b.messages.at(-1).message, /2 条删除操作.*等待服务器同步/);
});
test('permissions and cancelled confirmation leave review records and delete intents untouched', () => {
  for (const permissions of [[], ['reviewRecord','deleteRecord']]) {
    const b = browser({ permissions }), marked = []; b.ctx.confirm = () => false;
    b.ctx.__QC_MARK_DELETED = ids => marked.push(...ids);
    b.run('batchApproveSelected();batchDeleteSelected()');
    assert.deepEqual(b.json('state.records'), b.records); assert.deepEqual(marked, []); assert.equal(b.writes.length, 0);
  }
  const b = browser({ permissions: ['deleteRecord'] }); b.run("_reviewTab='approved';_reviewSelected=new Set([3]);batchDeleteSelected()");
  assert.deepEqual(b.json('state.records'), b.records); assert.equal(b.messages.at(-1).type, 'error');
});
test('render and tab switches discard stale selections and hide unauthorized batch controls', () => {
  const b = browser({ permissions: [] }); b.run('_reviewSelected.add(3);_reviewSelected.add(99);renderReviewPage()');
  assert.deepEqual(b.json('[..._reviewSelected]'), [1,2]);
  assert.ok(!b.wrap.innerHTML.includes('onclick="batchApproveSelected()"'));
  assert.ok(!b.wrap.innerHTML.includes('onclick="batchDeleteSelected()"'));
  b.run("setReviewTab('rejected')"); assert.deepEqual(b.json('[..._reviewSelected]'), []);
});
test('empty or moved selections cannot silently act on another review tab', () => {
  const b = browser(); b.run("_reviewSelected=new Set([3,99]);batchApproveSelected();batchDeleteSelected()");
  assert.deepEqual(b.json('state.records'), b.records); assert.equal(b.writes.length, 0);
});
test('append and replacement import plans explicitly stage every new row as pending', () => {
  const b = browser();
  b.run("_importMappedFields={date:'date',supplier:'supplier',po:'orderNo'};_importParsedRows=[{date:'2026-10-31',supplier:'Fixture',po:'PO-NEW'}]");
  for (const mode of ['append','replace']) {
    const plan = b.json('_buildImportPlan(' + JSON.stringify(mode) + ')');
    assert.equal(plan.records.length, 1); assert.equal(plan.records[0].status, 'pending');
    assert.equal(plan.records[0].orderNo, 'PO-NEW');
  }
  assert.deepEqual(b.json('state.records'), b.records);
});

test('all review tabs expose record QA buttons with the existing records view permission',()=>{
 const b=browser();b.ctx.canView=()=>true;
 for(const tab of ['pending','rejected','approved']) {
  b.run("setReviewTab('"+tab+"')");
  const ids=b.records.filter(record=>record.status===tab).map(record=>record.id);
  for(const id of ids)assert.ok(b.wrap.innerHTML.includes('openQAApplication('+id+', this)'));
 }
 assert.deepEqual(b.json('state.records'),b.records);assert.equal(b.writes.length,0);
});
test('combined review QA uses only current-tab selections in displayed order and preserves review state',()=>{
 const b=browser(),calls=[];b.ctx.canView=()=>true;b.ctx.openQAApplication=(ids,trigger)=>calls.push({ids:Array.from(ids),trigger});
 const button={};b.ctx.reviewQATrigger=button;
 b.run('_reviewSelected.add(3);_reviewSelected.add(99);openReviewSelectedQAApplication(reviewQATrigger)');
 assert.deepEqual(calls,[{ids:[2,1],trigger:button}]);
 assert.deepEqual(b.json('state.records'),b.records);assert.equal(b.writes.length,0);
 b.run("setReviewTab('rejected');_reviewSelected.add(4);openReviewSelectedQAApplication(reviewQATrigger)");
 assert.equal(calls.length,1);assert.match(b.messages.at(-1).message,/至少两条/);
});
test('review QA selection button resets across tabs and stays disabled for empty or single selections',()=>{
 const b=browser(),button={};const get=b.ctx.document.getElementById;
 b.ctx.document.getElementById=id=>id==='btnReviewBatchQA'?button:get(id);b.ctx.canView=()=>true;
 b.run('renderReviewPage()');assert.equal(button.disabled,false);assert.match(button.textContent,/2条/);
 b.run("setReviewTab('approved')");assert.equal(button.disabled,true);
 b.run('toggleReviewSelect(3)');assert.equal(button.disabled,true);assert.match(button.textContent,/1条/);
 b.run('state.records=[];renderReviewPage()');assert.equal(button.disabled,true);assert.equal(button.textContent,'合并 QA 申请');
});
test('review-only visibility does not grant access to existing QA applications',()=>{
 const b=browser(),button={},calls=[];const get=b.ctx.document.getElementById;
 b.ctx.document.getElementById=id=>id==='btnReviewBatchQA'?button:get(id);b.ctx.canView=()=>false;b.ctx.openQAApplication=(...args)=>calls.push(args);
 b.run('renderReviewPage();openReviewSelectedQAApplication()');
 assert.equal(button.hidden,true);assert.equal(button.disabled,true);
 assert.ok(!b.wrap.innerHTML.includes('openQAApplication('));assert.equal(calls.length,0);assert.equal(b.writes.length,0);
});
