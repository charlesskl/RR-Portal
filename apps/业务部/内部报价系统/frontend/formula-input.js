(function exposeFormulaInput(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FormulaInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFormulaInput() {
  'use strict';

  function parseFormulaInput(value) {
    let text = String(value ?? '').trim();
    if (!text) return null;
    if (text.startsWith('=')) text = text.slice(1).trim();

    // 保留原有带分数输入习惯，例如 1 1/2、-1 1/2。
    const mixed = /^([+-]?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
    if (mixed) {
      const whole = Number(mixed[1]);
      const numerator = Number(mixed[2]);
      const denominator = Number(mixed[3]);
      if (!denominator) return null;
      const result = whole < 0 ? whole - numerator / denominator : whole + numerator / denominator;
      return Number.isFinite(result) ? result : null;
    }

    text = text
      .replace(/[×xX]/g, '*')
      .replace(/÷/g, '/')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/＋/g, '+')
      .replace(/[－−]/g, '-')
      .replace(/\s+/g, '');
    if (!text) return null;

    let index = 0;
    const peek = () => text[index];
    const take = () => text[index++];

    function parseNumber() {
      const start = index;
      let dots = 0;
      while (index < text.length && /[\d.]/.test(peek())) {
        if (peek() === '.' && ++dots > 1) return null;
        index++;
      }
      if (start === index) return null;
      const parsed = Number(text.slice(start, index));
      return Number.isFinite(parsed) ? parsed : null;
    }

    function parseFactor() {
      if (peek() === '+') {
        take();
        return parseFactor();
      }
      if (peek() === '-') {
        take();
        const value = parseFactor();
        return value == null ? null : -value;
      }
      if (peek() === '(') {
        take();
        const value = parseExpression();
        if (value == null || take() !== ')') return null;
        return value;
      }
      return parseNumber();
    }

    function parseTerm() {
      let value = parseFactor();
      if (value == null) return null;
      while (peek() === '*' || peek() === '/') {
        const operator = take();
        const right = parseFactor();
        if (right == null || (operator === '/' && right === 0)) return null;
        value = operator === '*' ? value * right : value / right;
        if (!Number.isFinite(value)) return null;
      }
      return value;
    }

    function parseExpression() {
      let value = parseTerm();
      if (value == null) return null;
      while (peek() === '+' || peek() === '-') {
        const operator = take();
        const right = parseTerm();
        if (right == null) return null;
        value = operator === '+' ? value + right : value - right;
        if (!Number.isFinite(value)) return null;
      }
      return value;
    }

    const result = parseExpression();
    return result != null && index === text.length && Number.isFinite(result) ? result : null;
  }

  function toExcelFormulaInput(value) {
    const text = String(value ?? '').trim();
    if (!text.startsWith('=')) return null;
    const body = text.slice(1).trim();
    const mixed = /^([+-]?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(body);
    if (mixed) {
      const whole = Number(mixed[1]);
      const numerator = Number(mixed[2]);
      const denominator = Number(mixed[3]);
      if (!denominator) return null;
      return whole < 0
        ? `(${whole}-${numerator}/${denominator})`
        : `(${whole}+${numerator}/${denominator})`;
    }
    const formula = body
      .replace(/[×xX]/g, '*')
      .replace(/÷/g, '/')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/＋/g, '+')
      .replace(/[－−]/g, '-')
      .replace(/\s+/g, '');
    if (!formula || parseFormulaInput(`=${formula}`) == null) return null;
    return formula;
  }

  function fractionNumberFormat(value) {
    const text = String(value ?? '').trim();
    if (!text || text.startsWith('=')) return null;
    const match = /^(?:[+-]?\d+(?:\.\d+)?\s+)?[+-]?\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
    if (!match || parseFormulaInput(text) == null) return null;
    const denominatorDigits = String(match[1]).replace(/\D/g, '').length;
    const placeholders = '?'.repeat(Math.max(1, Math.min(denominatorDigits, 6)));
    return `# ${placeholders}/${placeholders}`;
  }

  return { parseFormulaInput, toExcelFormulaInput, fractionNumberFormat };
});
