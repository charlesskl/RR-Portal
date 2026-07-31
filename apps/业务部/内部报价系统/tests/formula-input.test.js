'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseFormulaInput,
  toExcelFormulaInput,
  fractionNumberFormat,
} = require('../frontend/formula-input');

test('formula input evaluates fractions and arithmetic safely', () => {
  assert.equal(parseFormulaInput('1/2'), 0.5);
  assert.equal(parseFormulaInput('3*0.25'), 0.75);
  assert.equal(parseFormulaInput('(10+2)/4'), 3);
  assert.equal(parseFormulaInput('=2×3+1'), 7);
  assert.equal(parseFormulaInput('1 1/2'), 1.5);
});

test('formula input rejects invalid or unsafe expressions', () => {
  assert.equal(parseFormulaInput(''), null);
  assert.equal(parseFormulaInput('1/0'), null);
  assert.equal(parseFormulaInput('2**3'), null);
  assert.equal(parseFormulaInput('alert(1)'), null);
  assert.equal(parseFormulaInput('1+'), null);
});

test('only explicit equals input is preserved as an Excel formula', () => {
  assert.equal(toExcelFormulaInput('=1/2'), '1/2');
  assert.equal(toExcelFormulaInput('=2×3+1'), '2*3+1');
  assert.equal(toExcelFormulaInput('=1 1/2'), '(1+1/2)');
  assert.equal(toExcelFormulaInput('1/2'), null);
  assert.equal(toExcelFormulaInput('=1/0'), null);
  assert.equal(toExcelFormulaInput('=SUM(A1:A2)'), null);
});

test('fractions without equals use an Excel fraction display format', () => {
  assert.equal(fractionNumberFormat('1/2'), '# ?/?');
  assert.equal(fractionNumberFormat('1 1/16'), '# ??/??');
  assert.equal(fractionNumberFormat('=1/2'), null);
  assert.equal(fractionNumberFormat('3*0.25'), null);
});
