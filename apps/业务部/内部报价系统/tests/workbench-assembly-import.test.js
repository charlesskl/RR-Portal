'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workbenchPath = path.join(__dirname, '..', 'frontend', 'workbench.js');
const source = fs.readFileSync(workbenchPath, 'utf8');

test('packaging assembly import keeps the packaging fallback kind', () => {
  assert.match(source, /const\s+addImportedStepGroups\s*=\s*\(j,\s*fallbackKind\s*=\s*'assembly'\)\s*=>\s*{/);
  assert.match(source, /const\s+importGroupSummary\s*=\s*\(j,\s*fallbackKind\s*=\s*'assembly'\)\s*=>\s*{/);

  const fallbackBuildCalls = source.match(/buildImportedStepGroups\(j,\s*fallbackKind\)/g) || [];
  assert.equal(fallbackBuildCalls.length, 2);

  assert.match(source, /const\s+info\s*=\s*importGroupSummary\(j,\s*'packaging'\);/);
  assert.match(source, /addImportedStepGroups\(j,\s*'packaging'\);/);
});
