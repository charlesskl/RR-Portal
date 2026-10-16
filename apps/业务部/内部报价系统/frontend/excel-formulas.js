(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExcelFormulas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const key = (sheet, address) => `${sheet}!${address.replace(/\$/g, '').toUpperCase()}`;
  const split = id => { const i = id.lastIndexOf('!'); return [id.slice(0, i), id.slice(i + 1)]; };
  const col = name => [...name].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  function letters(n) { let s = ''; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
  function range(from, to) {
    const [sheet, a] = split(from), [, b] = split(to);
    if (split(to)[0] !== sheet) throw new Error('不支持跨工作表三维区域');
    const ma = a.match(/^([A-Z]+)(\d+)$/), mb = b.match(/^([A-Z]+)(\d+)$/);
    const result = [];
    for (let r = Number(ma[2]); r <= Number(mb[2]); r++) {
      const row = [];
      for (let c = col(ma[1]); c <= col(mb[1]); c++) row.push(key(sheet, `${letters(c)}${r}`));
      result.push(row);
      if (result.length * Math.max(row.length, 1) > 50000) throw new Error('公式区域过大');
    }
    return result;
  }
  function parse(formula, sheet) {
    const input = String(formula).replace(/^=/, '');
    const tokens = []; let pos = 0;
    while (pos < input.length) {
      const s = input.slice(pos); let m;
      if ((m = s.match(/^\s+/))) { pos += m[0].length; continue; }
      if ((m = s.match(/^(?:(?:'((?:[^']|'')+)'|([^\s+*/^(),:<>="!]+))!)?(\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_])/))) {
        tokens.push({ kind: 'ref', value: key((m[1]?.replace(/''/g, "'") || m[2]) ?? sheet, m[3]), qualified: Boolean(m[1] || m[2]) });
      } else if ((m = s.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/))) tokens.push({ kind: 'value', value: Number(m[0]) });
      else if ((m = s.match(/^"((?:[^"]|"")*)"/))) tokens.push({ kind: 'value', value: m[1].replace(/""/g, '"') });
      else if ((m = s.match(/^[A-Za-z_][A-Za-z0-9_.]*/))) tokens.push({ kind: 'name', value: m[0].toUpperCase() });
      else if ((m = s.match(/^(?:<>|<=|>=|[+\-*/^%(),:;=<>])/))) tokens.push({ kind: m[0] === ';' ? ',' : m[0] });
      else throw new Error(`无法识别公式：${s.slice(0, 24)}`);
      pos += m[0].length;
    }
    let i = 0;
    const peek = kind => tokens[i]?.kind === kind;
    const take = kind => { if (!peek(kind)) throw new Error(`公式缺少 ${kind}`); return tokens[i++]; };
    function primary() {
      let node;
      if (peek('+') || peek('-')) { const op = tokens[i++].kind; node = { type: 'unary', op, a: primary() }; }
      else if (peek('(')) { i++; node = expression(0); take(')'); }
      else if (peek('value')) node = { type: 'value', value: tokens[i++].value };
      else if (peek('ref')) {
        const first = tokens[i++]; node = { type: 'ref', key: first.value };
        if (peek(':')) {
          i++; const last = take('ref');
          const end = last.qualified ? last.value : key(split(first.value)[0], split(last.value)[1]);
          node = { type: 'range', keys: range(first.value, end) };
        }
      } else if (peek('name')) {
        const name = tokens[i++].value;
        if (name === 'TRUE' || name === 'FALSE') node = { type: 'value', value: name === 'TRUE' };
        else {
          if (!['SUM', 'AVERAGE', 'HLOOKUP'].includes(name)) throw new Error(`暂不支持函数 ${name}`);
          take('('); const args = [];
          if (!peek(')')) { do { if (peek(',')) i++; args.push(expression(0)); } while (peek(',')); }
          take(')'); node = { type: 'call', name, args };
        }
      } else throw new Error('公式不完整');
      while (peek('%')) { i++; node = { type: 'unary', op: '%', a: node }; }
      return node;
    }
    const precedence = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };
    function expression(min) {
      let node = primary();
      while ((precedence[tokens[i]?.kind] || 0) > min) {
        const op = tokens[i++].kind;
        node = { type: 'binary', op, a: node, b: expression(precedence[op]) };
      }
      return node;
    }
    const ast = expression(0);
    if (i !== tokens.length) throw new Error('公式有多余内容');
    return ast;
  }
  function refs(ast) {
    if (ast.type === 'ref') return [ast.key];
    if (ast.type === 'range') return ast.keys.flat();
    return [...(ast.a ? refs(ast.a) : []), ...(ast.b ? refs(ast.b) : []), ...(ast.args || []).flatMap(refs)];
  }
  function numeric(v) {
    if (v == null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('#VALUE! 非数值参与计算');
    return n;
  }
  function createEvaluator(model, overrides = {}) {
    const cache = new Map(), active = new Set(), astCache = new Map(), fallbacks = new Map();
    const cell = id => Object.hasOwn(overrides, id) ? { ...model.cells[id], ...overrides[id] } : model.cells[id];
    function ast(id) {
      if (!astCache.has(id)) astCache.set(id, parse(cell(id).f, split(id)[0]));
      return astCache.get(id);
    }
    function evaluate(node) {
      if (node.type === 'value') return node.value;
      if (node.type === 'ref') return value(node.key);
      if (node.type === 'range') return node.keys.map(row => row.map(value));
      if (node.type === 'unary') { const a = numeric(evaluate(node.a)); return node.op === '-' ? -a : node.op === '%' ? a / 100 : a; }
      if (node.type === 'binary') {
        const a = numeric(evaluate(node.a)), b = numeric(evaluate(node.b));
        switch (node.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': if (b === 0) throw new Error('#DIV/0! 分母为零'); return a / b;
          case '^': return a ** b; case '=': return a === b; case '<>': return a !== b;
          case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        }
      }
      const args = node.args.map(evaluate);
      if (node.name === 'SUM' || node.name === 'AVERAGE') {
        const numbers = args.flat(Infinity).filter(v => typeof v === 'number');
        const sum = numbers.reduce((s, n) => s + n, 0);
        if (node.name === 'SUM') return sum;
        if (!numbers.length) throw new Error('#DIV/0! 没有可平均的数值');
        return sum / numbers.length;
      }
      if (node.name === 'HLOOKUP') {
        const [lookup, table, row, approx = true] = args;
        if (!Array.isArray(table) || !table[numeric(row) - 1]) throw new Error('#REF! 查找区域或行号无效');
        let index = table[0].findIndex(v => typeof v === 'string' && typeof lookup === 'string'
          ? v.toLowerCase() === lookup.toLowerCase() : v === lookup);
        if (index < 0 && approx) table[0].forEach((v, i) => { if (v != null && v <= lookup) index = i; });
        if (index < 0) throw new Error('#N/A 找不到对应基数');
        return table[numeric(row) - 1][index] ?? 0;
      }
      throw new Error(`暂不支持函数 ${node.name}`);
    }
    function value(id) {
      if (cache.has(id)) return cache.get(id);
      if (active.has(id)) throw new Error(`循环引用：${id}`);
      const c = cell(id);
      if (!c) return null;
      if (c.missing_sheet) throw new Error(`缺少来源工作表：${split(id)[0]}`);
      if (c.t === 'e') throw new Error(`原表错误：${id}`);
      active.add(id);
      try {
        // Imported direct links can retain a saved result even when their
        // source cell is now empty. Preserve that value, not an invented zero.
        // Explicit edits (including clearing a source) must remain authoritative.
        if(c.f && !c.external_input && !Object.hasOwn(overrides,id) && c.v!=null && c.v!=='' && ast(id).type==='ref'){
          const target=ast(id).key,source=cell(target);
          if(!Object.hasOwn(overrides,target)&&(!source||source.missing_sheet||(!source.f&&(source.v==null||source.v==='')))){
            fallbacks.set(id,`引用 ${target} 无可用值，沿用原表保存值：${c.v}`);
            cache.set(id,c.v);return c.v;
          }
        }
        const result = c.f && !c.external_input ? evaluate(ast(id)) : (c.v ?? null);
        if (typeof result === 'number' && !Number.isFinite(result)) throw new Error('计算结果非有限数值');
        cache.set(id, result); return result;
      } finally { active.delete(id); }
    }
    function dependencies(id, recursive = false, seen = new Set()) {
      if (!cell(id)?.f || cell(id)?.external_input || seen.has(id)) return [];
      seen.add(id); const direct = refs(ast(id));
      return [...new Set([...direct, ...(recursive ? direct.flatMap(k => dependencies(k, true, seen)) : [])])];
    }
    return { value, cell, dependencies, fallback: id => fallbacks.get(id) || '' };
  }
  return { key, split, parse, references: (formula, sheet) => [...new Set(refs(parse(formula, sheet)))], createEvaluator };
});
