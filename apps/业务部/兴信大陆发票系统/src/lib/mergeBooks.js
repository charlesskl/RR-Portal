/**
 * 跨工作簿合并：把多个生成的 xlsx（ArrayBuffer）按顺序合并成一个工作簿。
 * 各来源文件的 styles.xml 不同 → 合并时把来源 cellXfs（及其引用的 font/fill/border/numFmt）
 * 匹配或追加进目标 styles.xml，并重写 sheet XML 里的样式索引（单元格/行的 s= 与 <col style=>）。
 * 生成的 sheet 可能带 sharedStrings 引用（t="s"）：合并时把来源 sharedStrings 单元格改写为内联字符串，
 * 样式索引重写同前。无条件格式/超链接/图片，可安全合并。
 * 纯 ESM，浏览器 / Node 通用。
 */

import JSZip from 'jszip';
import { XlsxPackage } from './xlsxPackage.js';

/** 取 styles.xml 某段（numFmts/fonts/fills/borders/cellXfs）的子元素字符串数组 */
function sectionItems(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  const items = [];
  const re = /<(\w+)(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/\1>)/g;
  let mm;
  while ((mm = re.exec(m[1]))) items.push(mm[0]);
  return items;
}

/** 用新子元素数组重建 styles.xml 的某段（count 同步更新）；段落不存在时按 schema 位置插入 */
function setSection(xml, tag, items) {
  const repl = `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`);
  // 替换串里可能含 $&/$" 等特殊序列（如 formatCode="US$"），必须用函数替换
  if (re.test(xml)) return xml.replace(re, () => repl);
  if (tag === 'numFmts' && /<fonts\b/.test(xml)) return xml.replace(/<fonts\b/, () => repl + '<fonts');
  throw new Error(`styles.xml 缺少 <${tag}> 段`);
}

const attrOf = (el, name) => {
  const m = el.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** 改写 xf 元素开始标签里的四个引用属性（缺则补上） */
function setXfRefs(xf, refs) {
  return xf.replace(/^<xf\b([^>]*?)(\/?>)/, (m, attrs, close) => {
    let s = attrs;
    for (const [k, v] of Object.entries(refs)) {
      if (new RegExp(`\\b${k}="`).test(s)) s = s.replace(new RegExp(`\\b${k}="[^"]*"`), `${k}="${v}"`);
      else s += ` ${k}="${v}"`;
    }
    return `<xf${s}${close}`;
  });
}

/** 目标 styles.xml 的增量合并器：来源索引 → 目标索引 */
export class StylesMerger {
  constructor(dstStylesXml) {
    this.xml = dstStylesXml;
    this.numFmts = sectionItems(dstStylesXml, 'numFmts') || [];
    this.fonts = sectionItems(dstStylesXml, 'fonts');
    this.fills = sectionItems(dstStylesXml, 'fills');
    this.borders = sectionItems(dstStylesXml, 'borders');
    this.cellXfs = sectionItems(dstStylesXml, 'cellXfs');
    if (!this.fonts || !this.fills || !this.borders || !this.cellXfs) throw new Error('目标 styles.xml 结构不完整');
    this.numFmtIdMax = this.numFmts.reduce((mx, x) => Math.max(mx, +(attrOf(x, 'numFmtId') || 0)), 163);
  }

  _idx(list, item) {
    const i = list.indexOf(item);
    if (i >= 0) return i;
    list.push(item);
    return list.length - 1;
  }

  _numFmtId(srcNumFmts, id) {
    id = +id || 0;
    if (id < 164) return id; // 内置格式 id 直通
    const src = srcNumFmts.find((x) => +(attrOf(x, 'numFmtId') || 0) === id);
    if (!src) return id;
    const code = attrOf(src, 'formatCode');
    const dst = this.numFmts.find((x) => attrOf(x, 'formatCode') === code);
    if (dst) return +(attrOf(dst, 'numFmtId') || 0);
    const newId = ++this.numFmtIdMax;
    this.numFmts.push(`<numFmt numFmtId="${newId}" formatCode="${code}"/>`);
    return newId;
  }

  /** 合并来源 styles.xml，返回来源 cellXfs 索引 → 目标索引的映射数组 */
  remap(srcStylesXml) {
    const sNumFmts = sectionItems(srcStylesXml, 'numFmts') || [];
    const sFonts = sectionItems(srcStylesXml, 'fonts');
    const sFills = sectionItems(srcStylesXml, 'fills');
    const sBorders = sectionItems(srcStylesXml, 'borders');
    const sXfs = sectionItems(srcStylesXml, 'cellXfs');
    const at = (list, i) => list[i] || list[0];
    return sXfs.map((xf) => {
      const refs = {
        numFmtId: this._numFmtId(sNumFmts, attrOf(xf, 'numFmtId')),
        fontId: this._idx(this.fonts, at(sFonts, +attrOf(xf, 'fontId') || 0)),
        fillId: this._idx(this.fills, at(sFills, +attrOf(xf, 'fillId') || 0)),
        borderId: this._idx(this.borders, at(sBorders, +attrOf(xf, 'borderId') || 0)),
      };
      return this._idx(this.cellXfs, setXfRefs(xf, refs));
    });
  }

  /** 追加完成后的目标 styles.xml */
  toXml() {
    let out = this.xml;
    if (this.numFmts.length) out = setSection(out, 'numFmts', this.numFmts);
    out = setSection(out, 'fonts', this.fonts);
    out = setSection(out, 'fills', this.fills);
    out = setSection(out, 'borders', this.borders);
    out = setSection(out, 'cellXfs', this.cellXfs);
    return out;
  }
}

/** 按映射重写 sheet XML 的样式索引：单元格/行的 s=、列的 style= */
export function rewriteSheetStyles(sheetXml, map) {
  return sheetXml
    .replace(/\bs="(\d+)"/g, (m, n) => `s="${map[+n] ?? n}"`)
    .replace(/(<col\b[^>]*?)\bstyle="(\d+)"/g, (m, pre, n) => `${pre}style="${map[+n] ?? n}"`);
}

/** 解析 sharedStrings.xml → 纯文本数组（多段富文本拼接，保留原转义） */
function sharedStringTexts(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(text);
  }
  return out;
}

/** 把 sheet XML 里 t="s"（sharedStrings 引用）的单元格改写为 inlineStr，合并时不再依赖来源 sharedStrings */
export function inlineSharedStrings(sheetXml, sst) {
  if (!sst.length || !/t="s"/.test(sheetXml)) return sheetXml;
  return sheetXml.replace(/<c\b([^>]*?)\bt="s"([^>]*?)>([\s\S]*?)<\/c>/g, (m, pre, post, inner) => {
    const vm = inner.match(/<v>(\d+)<\/v>/);
    if (!vm) return m;
    return `<c${pre}${post} t="inlineStr"><is><t xml:space="preserve">${sst[+vm[1]] ?? ''}</t></is></c>`;
  });
}

/** 从来源 workbook.xml 取每张 sheet 的打印区域（localSheetId → range），合并时透传 */
function sheetPrintAreas(workbookXml) {
  const out = new Map();
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([^<]+)<\/definedName>/g)) {
    // xlsxPackage 写成 _xlnm.Print_Area（OOXML 内建名），旧补丁脚本写成 Print_Area，两种都认
    if (!/\bname="(?:_xlnm\.)?Print_Area"/.test(m[1])) continue;
    const id = +(m[1].match(/\blocalSheetId="(\d+)"/) || [])[1];
    const range = m[2].split('!').pop();
    if (Number.isFinite(id) && range) out.set(id, range);
  }
  return out;
}

/**
 * 把多个 xlsx 按期望的 sheet 顺序合并成一个工作簿。
 * 入参：ArrayBuffer 数组，或 [{ buffer, tag }]（tag=客人名，用于重名 sheet 加后缀）。
 * 第一个文件作为基底（其 sheet 原样保留），其余文件的 sheet 经样式重映射后追加。
 * sheet 名冲突（同客主单/印尼单同号发票）时后到的加 `-客人tag` 后缀，超长截断，仍冲突加序号。
 */
export async function mergeWorkbookBuffers(entries) {
  const list = entries.map((e) => (e && e.buffer ? e : { buffer: e, tag: '' }));
  if (list.length === 1) return { buffer: list[0].buffer, renames: [] };
  const base = await XlsxPackage.load(list[0].buffer);
  const merger = new StylesMerger(await base.zip.file('xl/styles.xml').async('string'));
  const seen = new Set(base.getSheetNames());
  const renames = [];
  for (let i = 1; i < list.length; i++) {
    const src = await XlsxPackage.load(list[i].buffer);
    const map = merger.remap(await src.zip.file('xl/styles.xml').async('string'));
    const sstFile = src.zip.file('xl/sharedStrings.xml');
    const sst = sharedStringTexts(sstFile ? await sstFile.async('string') : null);
    const printAreas = sheetPrintAreas(src.workbookXml);
    const srcNames = src.getSheetNames();
    for (let si = 0; si < srcNames.length; si++) {
      const name = srcNames[si];
      let nm = name;
      if (seen.has(nm)) {
        const baseNm = (name + (list[i].tag ? `-${list[i].tag}` : '')).slice(0, 31);
        nm = baseNm;
        let k = 2;
        while (seen.has(nm)) nm = `${baseNm.slice(0, 28)}~${k++}`;
        renames.push({ from: name, to: nm });
      }
      seen.add(nm);
      const parts = await src.getTemplateParts(name);
      const pa = printAreas.get(si);
      base.addSheet({
        name: nm, sheetXml: inlineSharedStrings(rewriteSheetStyles(parts.sheetXml, map), sst),
        commentsXml: parts.commentsXml, vmlXml: parts.vmlXml, relsXml: parts.relsXml,
        definedNames: pa ? true : false, printArea: pa,
      });
    }
  }
  base.zip.file('xl/styles.xml', merger.toXml());
  const out = await base.save({ fullCalcOnLoad: true });
  return { buffer: out, renames };
}

const unescName = (s) =>
  s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * 合并后重排 sheet：按 keyOf(sheet名) 稳定排序改写 workbook.xml 的 <sheets> 顺序。
 * definedNames 里的 localSheetId 按位置引用 sheet，必须同步重映射，否则打印区域错位。
 * 顺序无需变化时直接返回原 buffer。
 */
export async function reorderWorkbookSheets(buffer, keyOf) {
  const zip = await JSZip.loadAsync(buffer);
  const wb = await zip.file('xl/workbook.xml').async('string');
  const sm = wb.match(/<sheets\b[^>]*>([\s\S]*?)<\/sheets>/);
  if (!sm) return buffer;
  const tags = [...sm[1].matchAll(/<sheet\b[^>]*(?:\/>|>[\s\S]*?<\/sheet>)/g)].map((m) => m[0]);
  const names = tags.map((t) => unescName(attrOf(t, 'name') || ''));
  const order = names.map((_, i) => i);
  order.sort((a, b) => {
    const ka = keyOf(names[a]), kb = keyOf(names[b]);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return a - b;
  });
  if (order.every((v, i) => v === i)) return buffer;
  const newIdx = new Map(order.map((oldIdx, pos) => [oldIdx, pos]));
  const sheetsRepl = sm[0].replace(sm[1], () => order.map((i) => tags[i]).join(''));
  let out = wb.replace(sm[0], () => sheetsRepl);
  out = out.replace(/<definedName\b[^>]*\blocalSheetId="\d+"[^>]*>[\s\S]*?<\/definedName>/g, (d) =>
    d.replace(/\blocalSheetId="(\d+)"/, (m, id) => `localSheetId="${newIdx.get(+id) ?? id}"`));
  out = out.replace(/\bactiveTab="\d+"/, 'activeTab="0"');
  zip.file('xl/workbook.xml', out);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
