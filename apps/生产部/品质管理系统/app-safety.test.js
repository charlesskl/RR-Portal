'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const mobileCss = fs.readFileSync(path.join(__dirname, 'mobile.css'), 'utf8');

function loadFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return vm.runInNewContext(`(${source.slice(start, index + 1)})`);
  }
  throw new Error(`Could not parse ${name}`);
}

test('record snapshot comparison detects data that refresh would overwrite', () => {
  const snapshotsDiffer = loadFunction(appSource, '_recordsSnapshotsDiffer');
  assert.equal(snapshotsDiffer([{ id: 1, value: 'same' }], [{ id: 1, value: 'same' }]), false);
  assert.equal(snapshotsDiffer([{ id: 1, value: 'local' }], [{ id: 1, value: 'server' }]), true);
  assert.equal(snapshotsDiffer([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
});

test('records page trims search text like the server export filter', () => {
  assert.match(appSource, /searchInput'\)\?\.value\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)/);
});

test('mobile modal controls keep a 16px font to avoid iOS focus zoom', () => {
  assert.match(mobileCss, /html\.qc-mobile \.modal textarea\s*\{[^}]*font-size:\s*16px\s*!important/s);
  assert.match(mobileCss, /html\.qc-narrow \.modal textarea\s*\{[^}]*font-size:\s*16px\s*!important/s);
});
