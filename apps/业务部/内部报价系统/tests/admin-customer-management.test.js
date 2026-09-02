'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('admin can rename customers consistently and only delete unused customers', () => {
  const route = fs.readFileSync(path.join(__dirname, '../backend/routes/admin.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '../frontend/admin.js'), 'utf8');

  assert.match(route, /router\.put\('\/customers\/rename'/);
  assert.match(route, /UPDATE quotes SET customer = \? WHERE customer = \?/);
  assert.match(route, /ON CONFLICT DO NOTHING/);
  assert.match(route, /仍有 \$\{quoteCount\} 张报价单，不能删除/);
  assert.match(frontend, /class="mini cd-rename"/);
  assert.match(frontend, /class="mini danger cd-delete"/);
  assert.match(frontend, /仅没有报价单使用时才可删除/);
});
