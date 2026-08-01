import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { apiUrl, isLoginRedirect, analysisStatusUrl } = require('../static/qc_urls.js');

test('apiUrl inserts api after the trusted portal prefix', () => {
  assert.equal(
    apiUrl('https://portal.example/qc-report/reports/7/photos', '/qc-report/api'),
    'https://portal.example/qc-report/api/reports/7/photos',
  );
});

test('isLoginRedirect recognizes the prefixed login path', () => {
  assert.equal(
    isLoginRedirect('https://portal.example/qc-report/login', '/qc-report/login'),
    true,
  );
  assert.equal(isLoginRedirect('https://portal.example/login', '/qc-report/login'), false);
});

test('analysisStatusUrl appends the run id to the rendered base', () => {
  assert.equal(
    analysisStatusUrl('/qc-report/api/analysis-runs/', 42),
    '/qc-report/api/analysis-runs/42',
  );
});
