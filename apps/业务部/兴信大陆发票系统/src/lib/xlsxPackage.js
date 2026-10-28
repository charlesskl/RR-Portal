/**
 * xlsx 包级手术：在不动既有 510 张 sheet 的前提下追加新 sheet。
 * 直接操作 zip 内的 XML，既有部件保持字节不变。
 * 纯 ESM，浏览器 / Node 通用。
 */

import JSZip from 'jszip';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** 解析 rels XML 为 [{ id, type, target }]（属性顺序无关，兼容 openpyxl/LibreOffice 写法） */
export function parseRels(relsXml) {
  const out = [];
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const get = (k) => {
      const am = attrs.match(new RegExp(`\\b${k}="([^"]*)"`));
      return am ? am[1] : null;
    };
    out.push({ id: get('Id'), type: get('Type'), target: get('Target') });
  }
  return out;
}

/**
 * 规范化新 sheet 的打印设置：一张发票一页完整 A4。
 * fitToWidth/fitToHeight 只有在 sheetPr/pageSetUpPr fitToPage="1" 时才生效，
 * 模板转换出来常缺这个开关（或写成 fitToPage="false"），导致按 100% 打印被裁成多页。
 * 面单等特意固定 scale 的模块用 addSheet({ printFit: false }) 跳过。
 */
export function normalizeSheetPrint(xml) {
  let x = xml;
  // sheetPr：确保 pageSetUpPr fitToPage="1"
  if (/<pageSetUpPr\b[^>]*\/>/.test(x)) {
    x = x.replace(/<pageSetUpPr\b([^>]*?)\/>/g, (m, a) =>
      /fitToPage="/.test(a) ? `<pageSetUpPr${a.replace(/fitToPage="[^"]*"/, 'fitToPage="1"')}/>` : `<pageSetUpPr${a} fitToPage="1"/>`);
  } else if (/<sheetPr\b[^/>]*\/>/.test(x)) {
    x = x.replace(/<sheetPr\b([^/>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>');
  } else if (/<sheetPr\b[^>]*>/.test(x)) {
    x = x.replace(/(<sheetPr\b[^>]*>)/, '$1<pageSetUpPr fitToPage="1"/>');
  } else {
    x = x.replace(/(<worksheet\b[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  }
  // pageSetup：确保 fitToWidth/fitToHeight = 1（缺 pageSetup 则补一份 A4 纵向）
  if (/<pageSetup\b[^>]*\/>/.test(x)) {
    x = x.replace(/<pageSetup\b([^>]*?)\/>/g, (m, a) => {
      let attrs = /fitToWidth="/.test(a) ? a.replace(/fitToWidth="[^"]*"/, 'fitToWidth="1"') : `${a} fitToWidth="1"`;
      attrs = /fitToHeight="/.test(attrs) ? attrs.replace(/fitToHeight="[^"]*"/, 'fitToHeight="1"') : `${attrs} fitToHeight="1"`;
      return `<pageSetup${attrs}/>`;
    });
  } else if (/<pageMargins\b[^>]*\/>/.test(x)) {
    x = x.replace(/(<pageMargins\b[^>]*\/>)/, '$1<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>');
  }
  return x;
}

export class XlsxPackage {
  static async load(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const pkg = new XlsxPackage();
    pkg.zip = zip;
    pkg.workbookXml = await zip.file('xl/workbook.xml').async('string');
    pkg.workbookRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    pkg.contentTypes = await zip.file('[Content_Types].xml').async('string');
    pkg.sheetNames = [...pkg.workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\/?>/g)]
      .map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    pkg.newSheets = [];
    return pkg;
  }

  /** 既有 sheet 名列表（顺序即 localSheetId 顺序） */
  getSheetNames() { return this.sheetNames.slice(); }

  /** 移除全部既有 sheet（其他客模式：模板本只提供模版，输出仅含生成的 sheet） */
  async stripAllSheets() {
    const entries = [...this.workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="(rId\d+)"[^>]*\/?>/g)]
      .map((m) => ({ name: m[1], rid: m[2] }));
    const relPairs = parseRels(this.workbookRels).map((r) => ({ id: r.id, target: r.target }));

    const removedTargets = [];
    for (const e of entries) {
      const rel = relPairs.find((r) => r.id === e.rid);
      if (!rel) continue;
      const m = rel.target.match(/sheet(\d+)\.xml$/);
      if (!m) continue;
      const idx = m[1];
      removedTargets.push(idx);
      for (const p of [
        `xl/worksheets/sheet${idx}.xml`,
        `xl/worksheets/_rels/sheet${idx}.xml.rels`,
        `xl/comments${idx}.xml`,
        `xl/comments/comment${idx}.xml`,
        `xl/drawings/vmlDrawing${idx}.vml`,
        `xl/drawings/commentsDrawing${idx}.vml`,
      ]) {
        if (this.zip.file(p)) this.zip.remove(p);
      }
    }

    let wb = this.workbookXml;
    for (const e of entries) {
      wb = wb.replace(new RegExp(`<sheet\\b[^>]*\\br:id="${e.rid}"[^>]*\\/>`), '');
    }
    wb = wb.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
    this.workbookXml = wb;

    let rels = this.workbookRels;
    for (const e of entries) {
      rels = rels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${e.rid}"[^>]*\\/>`), '');
    }
    this.workbookRels = rels;

    let ct = this.contentTypes;
    for (const idx of removedTargets) {
      ct = ct
        .replace(new RegExp(`<Override PartName="/xl/worksheets/sheet${idx}\\.xml"[^>]*/>`), '')
        .replace(new RegExp(`<Override PartName="/xl/comments${idx}\\.xml"[^>]*/>`), '')
        .replace(new RegExp(`<Override PartName="/xl/comments/comment${idx}\\.xml"[^>]*/>`), '')
        .replace(new RegExp(`<Override PartName="/xl/drawings/vmlDrawing${idx}\\.vml"[^>]*/>`), '')
        .replace(new RegExp(`<Override PartName="/xl/drawings/commentsDrawing${idx}\\.vml"[^>]*/>`), '');
    }
    this.contentTypes = ct;

    this.sheetNames = [];
    return this;
  }

  /** 只保留模版 sheet（用于"仅导出新增发票"），其余 sheet 部件全部移除 */
  async stripToTemplate(templateName) {
    const entries = [...this.workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="(rId\d+)"[^>]*\/?>/g)]
      .map((m) => ({ name: m[1], rid: m[2] }));
    const relPairs = [...this.workbookRels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g)]
      .map((m) => ({ id: m[1], target: m[2] }));
    const keepIdx = entries.findIndex((e) => e.name === templateName || e.name === esc(templateName));
    if (keepIdx < 0) throw new Error(`模版 sheet「${templateName}」不在工作簿里`);

    const removedFileIdx = [];
    entries.forEach((e, i) => {
      if (i === keepIdx) return;
      const rel = relPairs.find((r) => r.id === e.rid);
      if (!rel) return;
      const m = rel.target.match(/sheet(\d+)\.xml$/);
      if (!m) return;
      const idx = m[1];
      removedFileIdx.push(idx);
      for (const p of [
        `xl/worksheets/sheet${idx}.xml`,
        `xl/worksheets/_rels/sheet${idx}.xml.rels`,
        `xl/comments${idx}.xml`,
        `xl/drawings/vmlDrawing${idx}.vml`,
      ]) {
        if (this.zip.file(p)) this.zip.remove(p);
      }
    });

    // workbook.xml：删 sheet 条目（保留模版），definedNames 只留模版并重编号（原位替换保持元素顺序）
    let wb = this.workbookXml;
    for (const e of entries) {
      if (e.name === templateName || e.name === esc(templateName)) continue;
      wb = wb.replace(new RegExp(`<sheet\\b[^>]*\\br:id="${e.rid}"[^>]*\\/>`), '');
    }
    const tplDn = new RegExp(`<definedName\\b[^>]*\\blocalSheetId="${keepIdx}"[^>]*>[\\s\\S]*?</definedName>`, 'g');
    const tplDns = (wb.match(tplDn) || []).map((d) => d.replace(/localSheetId="\d+"/, 'localSheetId="0"'));
    if (tplDns.length) {
      wb = wb.replace(/<definedNames>[\s\S]*?<\/definedNames>/, `<definedNames>${tplDns.join('')}</definedNames>`);
    } else {
      wb = wb.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
    }
    this.workbookXml = wb;

    // workbook rels：删掉被移除 sheet 的关系
    let rels = this.workbookRels;
    for (const e of entries) {
      if (e.name === templateName || e.name === esc(templateName)) continue;
      rels = rels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${e.rid}"[^>]*\\/>`), '');
    }
    this.workbookRels = rels;

    // content types：删被移除部件的 Override
    let ct = this.contentTypes;
    for (const idx of removedFileIdx) {
      ct = ct
        .replace(new RegExp(`<Override PartName="/xl/worksheets/sheet${idx}\\.xml"[^>]*/>`), '')
        .replace(new RegExp(`<Override PartName="/xl/comments${idx}\\.xml"[^>]*/>`), '')
        .replace(new RegExp(`<Override PartName="/xl/drawings/vmlDrawing${idx}\\.vml"[^>]*/>`), '');
    }
    this.contentTypes = ct;

    this.sheetNames = [templateName];
    return this;
  }

  /** 取模版 sheet 的原始部件 */
  async getTemplateParts(sheetName) {
    const m = [...this.workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="(rId\d+)"[^>]*\/?>/g)]
      .find((mm) => mm[1] === sheetName || mm[1] === esc(sheetName));
    if (!m) throw new Error(`模版 sheet「${sheetName}」不在工作簿里`);
    const rid = m[2];
    const rel = parseRels(this.workbookRels).find((r) => r.id === rid);
    if (!rel) throw new Error('找不到模版 sheet 的关系');
    let target = rel.target.replace(/^\//, '');
    if (!target.startsWith('xl/')) target = target.replace(/^worksheets\//, 'xl/worksheets/');
    const base = target.split('/').pop();           // sheet510.xml
    const idx = base.match(/(\d+)\.xml$/)[1];
    const read = async (p) => {
      const f = this.zip.file(p);
      return f ? f.async('string') : null;
    };
    const relsXml = await read(`xl/worksheets/_rels/sheet${idx}.xml.rels`);
    // 批注 / 批注 VML 部件：从新式（comments1.xml）和老式（comments/comment1.xml）两种布局里找
    let commentsXml = await read(`xl/comments${idx}.xml`);
    let commentsVml = await read(`xl/drawings/vmlDrawing${idx}.vml`);
    if ((!commentsXml || !commentsVml) && relsXml) {
      for (const rm of relsXml.matchAll(/<Relationship\b[^>]*\bType="[^"]*\/(comments|vmlDrawing)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g)) {
        const p = rm[2].replace(/^\//, '').replace(/^\.\.\//, 'xl/');
        const full = p.startsWith('xl/') ? p : `xl/worksheets/${p}`;
        if (rm[1] === 'comments' && !commentsXml) commentsXml = await read(full);
        if (rm[1] === 'vmlDrawing' && !commentsVml) commentsVml = await read(full);
      }
    }
    return { sheetXml: await read(target), commentsXml, vmlXml: commentsVml, relsXml };
  }

  /** 追加一张新 sheet（sheetXml 由 sheetBuilder 生成）；definedNames:false 跳过 ZURU 专用打印区域 */
  addSheet({ name, sheetXml, commentsXml, vmlXml, relsXml, totalRow, definedNames, printArea, printFit }) {
    this.newSheets.push({ name, sheetXml, commentsXml, vmlXml, relsXml, totalRow, definedNames, printArea, printFit });
  }

  /** 生成最终文件（ArrayBuffer）；fullCalcOnLoad=true 让 Excel 打开时全量重算 */
  async save({ fullCalcOnLoad = false } = {}) {
    const zip = this.zip;
    const n0 = this.sheetNames.length;

    // —— 计算新编号 ——
    let maxSheetFile = 0, maxRid = 0, maxSheetId = 0;
    for (const f of Object.keys(zip.files)) {
      const m = f.match(/^xl\/worksheets\/sheet(\d+)\.xml$/);
      if (m) maxSheetFile = Math.max(maxSheetFile, +m[1]);
    }
    for (const m of this.workbookRels.matchAll(/\bId="rId(\d+)"/g)) maxRid = Math.max(maxRid, +m[1]);
    for (const m of this.workbookXml.matchAll(/\bsheetId="(\d+)"/g)) maxSheetId = Math.max(maxSheetId, +m[1]);

    // 把模版 rels 里的批注/VML Target 重定向到新文件编号，返回 { patchedRels, parts:[{path, content, kind}] }
    const rewireRels = (relsXml, commentsXml, vmlXml, fileIdx) => {
      const parts = [];
      const patched = relsXml.replace(
        /<Relationship\b[^>]*\bType="[^"]*\/(comments|vmlDrawing)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g,
        (tag, kind, target) => {
          const content = kind === 'comments' ? commentsXml : vmlXml;
          if (!content) return '';            // 模版部件缺失（理论上不会），去掉这个关系
          let p = target.replace(/^\//, '').replace(/^\.\.\//, 'xl/');
          if (!p.startsWith('xl/')) p = `xl/worksheets/${p}`;
          p = p.replace(/(\D)\d*(\.(?:xml|vml))$/, `$1${fileIdx}$2`);
          parts.push({ path: p, content, kind });
          return tag.replace(target, p.replace(/^xl\//, '../'));
        });
      return { patchedRels: patched, parts };
    };

    // —— 1. 写新部件 ——
    const entries = [];
    const extraParts = [];
    this.newSheets.forEach((s, i) => {
      const fileIdx = maxSheetFile + 1 + i;
      const rid = `rId${maxRid + 1 + i}`;
      const sheetId = maxSheetId + 1 + i;
      zip.file(`xl/worksheets/sheet${fileIdx}.xml`, s.printFit === false ? s.sheetXml : normalizeSheetPrint(s.sheetXml));
      if (s.relsXml) {
        // 其他客模式：沿用模版 sheet 的关系文件（批注/VML 的 Id 与 sheet XML 里的引用一致）
        const { patchedRels, parts } = rewireRels(s.relsXml, s.commentsXml, s.vmlXml, fileIdx);
        zip.file(`xl/worksheets/_rels/sheet${fileIdx}.xml.rels`, patchedRels);
        for (const p of parts) { zip.file(p.path, p.content); extraParts.push(p); }
      } else if (s.commentsXml && s.vmlXml) {
        const rels =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${fileIdx}.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${fileIdx}.vml"/>` +
          `</Relationships>`;
        zip.file(`xl/worksheets/_rels/sheet${fileIdx}.xml.rels`, rels);
        zip.file(`xl/comments${fileIdx}.xml`, s.commentsXml);
        zip.file(`xl/drawings/vmlDrawing${fileIdx}.vml`, s.vmlXml);
        extraParts.push({ path: `xl/comments${fileIdx}.xml`, kind: 'comments' });
        extraParts.push({ path: `xl/drawings/vmlDrawing${fileIdx}.vml`, kind: 'vmlDrawing' });
      }
      entries.push({ ...s, fileIdx, rid, sheetId, localSheetId: n0 + i });
    });

    // —— 2. workbook.xml：追加 sheet 条目 + definedNames ——
    let wb = this.workbookXml;
    const sheetTags = entries.map((e) =>
      `<sheet name="${esc(e.name)}" sheetId="${e.sheetId}" state="visible" r:id="${e.rid}"/>`).join('');
    wb = wb.replace('</sheets>', sheetTags + '</sheets>');
    const dnTags = entries.filter((e) => e.definedNames !== false).map((e) => {
      const nm = esc(e.name).replace(/'/g, "''");
      // 华康B：调用方直接给打印区域（如 '$A$1:$J$37'），不带筛选区
      if (e.printArea) {
        return `<definedName function="false" hidden="false" localSheetId="${e.localSheetId}" name="_xlnm.Print_Area" vbProcedure="false">&apos;${nm}&apos;!${e.printArea}</definedName>`;
      }
      const t = e.totalRow;
      return `<definedName function="false" hidden="false" localSheetId="${e.localSheetId}" name="Excel_BuiltIn__FilterDatabase" vbProcedure="false">&apos;${nm}&apos;!$G$${t - 1}:$I$${t}</definedName>` +
        `<definedName function="false" hidden="false" localSheetId="${e.localSheetId}" name="_xlnm.Print_Area" vbProcedure="false">&apos;${nm}&apos;!$A$9:$I$${t}</definedName>`;
    }).join('');
    if (dnTags) {
      if (/<definedNames>/.test(wb)) wb = wb.replace('</definedNames>', dnTags + '</definedNames>');
      else wb = wb.replace('</workbook>', `<definedNames>${dnTags}</definedNames></workbook>`);
    }
    if (fullCalcOnLoad) {
      if (/<calcPr\b[^>]*\/>/.test(wb)) {
        wb = wb.replace(/<calcPr\b([^>]*?)\/>/g, (tag, attrs) =>
          /\bfullCalcOnLoad="/.test(attrs) ? tag.replace(/\bfullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"') : `<calcPr${attrs} fullCalcOnLoad="1"/>`);
      } else {
        wb = wb.replace('</sheets>', '</sheets><calcPr fullCalcOnLoad="1"/>');
      }
    }
    zip.file('xl/workbook.xml', wb);

    // —— 3. workbook rels ——
    let rels = this.workbookRels;
    const relTags = entries.map((e) =>
      `<Relationship Id="${e.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${e.fileIdx}.xml"/>`).join('');
    rels = rels.replace('</Relationships>', relTags + '</Relationships>');
    zip.file('xl/_rels/workbook.xml.rels', rels);

    // —— 4. [Content_Types].xml ——
    let ct = this.contentTypes;
    const hasVmlOverride = ct.includes('vmlDrawing');
    const overrides = entries.map((e) =>
      `<Override PartName="/xl/worksheets/sheet${e.fileIdx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join('') + extraParts.map((p) => {
      if (p.kind === 'comments')
        return `<Override PartName="/${p.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`;
      return hasVmlOverride && !new RegExp(`PartName="/${p.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(ct)
        ? `<Override PartName="/${p.path}" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>` : '';
    }).join('');
    ct = ct.replace('</Types>', overrides + '</Types>');
    // vml 部件走 Default 扩展名声明（老模版本没有 Override 惯例），缺则补上
    if (extraParts.some((p) => p.kind === 'vmlDrawing') && !ct.includes('Extension="vml"')) {
      ct = ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>');
    }
    // 去掉 app.xml（extended-properties），避免 TitlesOfParts 不一致导致修复提示
    ct = ct.replace(/<Override PartName="\/docProps\/app\.xml"[^>]*\/>/g, '');
    zip.file('[Content_Types].xml', ct);

    // —— 5. 移除 app.xml / calcChain.xml 及其关系 ——
    if (zip.file('docProps/app.xml')) {
      zip.remove('docProps/app.xml');
      const rootRelsPath = '_rels/.rels';
      let rootRels = await zip.file(rootRelsPath).async('string');
      rootRels = rootRels.replace(/<Relationship[^>]*extended-properties[^>]*\/>/g, '');
      zip.file(rootRelsPath, rootRels);
    }
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      let rr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
      rr = rr.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, '');
      zip.file('xl/_rels/workbook.xml.rels', rr);
    }

    // —— 6. styles.xml：含 mmm（月份简写）的日期格式去掉 [$-804] 中文区域锁，改 [$-409]，
    //    保证「18-Mar-26」在任何 Excel/WPS 区域设置下都显示英文月份简写 ——
    if (zip.file('xl/styles.xml')) {
      const styles = await zip.file('xl/styles.xml').async('string');
      const patched = styles.replace(/<numFmt\b[^>]*formatCode="[^"]*mmm[^"]*"[^>]*\/>/g,
        (tag) => tag.replace(/\[\$-804\]/g, '[$-409]'));
      if (patched !== styles) zip.file('xl/styles.xml', patched);
    }

    return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  }
}
