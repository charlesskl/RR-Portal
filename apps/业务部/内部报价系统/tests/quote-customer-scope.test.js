'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('new quote customer is selected only from account-authorized customers', () => {
  const route = fs.readFileSync(path.join(__dirname, '../backend/routes/quotes.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../frontend/main.js'), 'utf8');
  assert.match(route, /JOIN user_factories uf ON uf\.user_id = uc\.user_id/);
  assert.match(route, /该客户不在当前账号的授权范围内/);
  assert.match(html, /id="q-customer"[^>]+readonly/);
  assert.match(html, /id="q-customer-clear"[^>]+清空已选客户/);
  assert.match(main, /当前账号暂无授权客户，请联系管理员配置/);
  assert.match(main, /function clearSelection\(\)/);
  assert.match(main, /event\.key === 'Backspace' \|\| event\.key === 'Delete'/);
  assert.doesNotMatch(main, /＋ 新建客户/);
});

test('engineering accounts can create quotes and edit quote header data', () => {
  const route = fs.readFileSync(path.join(__dirname, '../backend/routes/quotes.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../frontend/main.js'), 'utf8');
  const workbench = fs.readFileSync(path.join(__dirname, '../frontend/workbench.js'), 'utf8');

  assert.match(main, /me\.dept === 'sales' \|\| me\.dept === 'engineering'/);
  assert.match(route, /!\['sales', 'engineering'\]\.includes\(req\.user\.dept\)/);
  assert.match(route, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?\)/);
  assert.match(route, /run\(normalizedQuoteNo, normalizedProductName, normalizedCustomer, qty \|\| null, version \|\| null, req\.user\.dept/);
  assert.match(route, /只有业务或工程可改表头/);
  assert.match(route, /quote_no, product_name, customer, qty, version/);
  assert.match(route, /货号「\$\{normalizedQuoteNo\}」已被占用/);
  assert.match(route, /if \(customer !== undefined\)[\s\S]+该客户不在当前账号的授权范围内/);
  assert.match(workbench, /function renderEngineeringQuoteHeader\(/);
  assert.match(workbench, /保存表头资料/);
  assert.match(workbench, /id="eng-h-no"/);
  assert.match(workbench, /renderEngineeringQuoteHeader\(headerHost, quote, authorizedCustomers/);
});
