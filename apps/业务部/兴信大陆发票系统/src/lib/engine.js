/**
 * 应用引擎：串起 基础工作簿 → 源表解析 → 生成 → 验证报告。
 * 浏览器专用（fetch 内置母版），生成逻辑与 Node 测试共用同一套 lib。
 */
import * as XLSX from 'xlsx';
import { parseWorkbook, extractInvoices, buildJobs, invoiceTotal, fmtDate } from './invoice.js';
import { SheetBuilder } from './sheetBuilder.js';
import { ZuruSheetBuilder } from './zuruSheetBuilder.js';
import { XlsxPackage } from './xlsxPackage.js';

/** 读母版里某张已有 sheet 的明细合计（用于 -2 段补前段合计） */
function baseSheetTotal(baseWb, name) {
  const ws = baseWb && baseWb.Sheets[name];
  if (!ws) return null;
  let t = 0, found = false;
  for (let r = 24; r <= 47; r++) {
    const c = ws[`C${r}`], d = ws[`D${r}`], k = ws[`K${r}`];
    if (c && d && k && typeof d.v === 'number' && typeof k.v === 'number') {
      t += k.v * 0.967 * d.v;
      found = true;
    }
  }
  return found ? t : null;
}

/** 生成 + 验证。返回 { output: ArrayBuffer, report: [...], skipped: [...] }；
 *  zuruTplBuffer 提供时（兴信 ZURU 新模板）：输出包 = 该模板本（兴信抬头新版式，仅含生成的 sheet），
 *  baseBuffer 仍用于已存在检测与前段合计读取 */
export async function generate({ baseBuffer, baseName, invoices, selected, onProgress, slimOutput, zuruTplBuffer, baseIsTemplate = false }) {
  const zuruMode = !!zuruTplBuffer;
  let pkg, builder;
  if (zuruMode) {
    pkg = await XlsxPackage.load(zuruTplBuffer);
    builder = new ZuruSheetBuilder(await pkg.getTemplateParts('兴信-zuru'));
    await pkg.stripAllSheets();   // 模板本只提供版式，输出仅含生成的 sheet
  } else {
    pkg = await XlsxPackage.load(baseBuffer);
    builder = new SheetBuilder(await pkg.getTemplateParts('98631'));
    if (slimOutput || baseIsTemplate) await pkg.stripAllSheets();   // 仅导出新增发票（不带母版旧票，也不带模版参考）
  }
  // 母版值（SheetJS，只读前 60 行），用于已存在检测 & 前段合计
  const baseWb = XLSX.read(baseBuffer, { type: 'array', cellDates: true, sheetRows: 60 });
  const baseNames = new Set(baseIsTemplate ? [] : (zuruMode || slimOutput ? baseWb.SheetNames : pkg.getSheetNames()));

  // 按发票号排序生成：基号与各段（-1/-2）及 REV 续票相邻，sheet 目录更整齐
  const invKey = (name) => {
    const m = String(name).match(/\d+/);
    return { n: m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER, s: String(name) };
  };
  const todo = invoices.filter((v) => selected.has(v.outSheetName)).sort((a, b) => {
    const ka = invKey(a.outSheetName), kb = invKey(b.outSheetName);
    if (ka.n !== kb.n) return ka.n - kb.n;
    return ka.s < kb.s ? -1 : ka.s > kb.s ? 1 : 0;
  });
  const skipped = [];
  const jobs = buildJobs(todo);

  // 补算：-2/-3 段的前段若已在母版里，累计合计要包含前段
  const groups = new Map();
  for (const j of jobs) {
    const base = j.inv.outSheetName.replace(/-\d+$/, '');
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(j);
  }
  const warnings = [];
  for (const [base, parts] of groups) {
    if (parts[0].inv.outSheetName === base) continue;   // 第一段已选中，累计完整
    // 第一段不在本次选择里：尝试从母版读前段合计（适用于只选了 -2/-3 段的情况）
    const last = parts[parts.length - 1];
    let fromBase = 0;
    let prefixTotal = 0;
    const selectedNames = new Set(parts.map((p) => p.inv.outSheetName));
    // 前段可能有多段（X, X-2 …），把母版里存在的、且不在选择中的前段都算上
    const allPartNames = [...baseNames].filter((n) => n === base || n.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`)));
    for (const n of allPartNames) {
      if (selectedNames.has(n)) continue;
      const t = baseSheetTotal(baseWb, n);
      if (t !== null) { prefixTotal += t; fromBase++; }
    }
    if (prefixTotal !== 0) {
      if (last.totalFromSrc) {
        // 末段合计已取源票标注的整单合计，本身就含前段，无需再加
        warnings.push(`${base} 系列：前段不在本次生成范围，合计以源票标注的整单合计为准（已含前段）`);
      } else {
        last.totalValue = (last.totalValue ?? 0) + prefixTotal;
        warnings.push(`${base} 系列：前段不在本次生成范围，累计合计已包含母版里 ${fromBase} 张前段的金额`);
      }
    }
  }

  const report = [];
  let done = 0;
  for (const j of jobs) {
    const { inv } = j;
    if (baseNames.has(inv.outSheetName)) {
      skipped.push(inv.outSheetName);
      report.push({ name: inv.outSheetName, status: 'skipped', note: '母版已存在，跳过' });
      continue;
    }
    if (zuruMode) {
      // 兴信 ZURU 新模板：数据区行 19-43，TOTAL 行 = max(44, 19+n)，打印区域 A1:I{totalRow}
      const totalRow = Math.max(44, 19 + inv.lines.length);
      pkg.addSheet({
        name: inv.outSheetName,
        sheetXml: builder.build(inv, j.totalValue),
        totalRow,
        definedNames: true,
        printArea: `$A$1:$I$${totalRow}`,
      });
    } else {
      const totalRow = Math.max(48, 24 + inv.lines.length);
      pkg.addSheet({
        name: inv.outSheetName,
        sheetXml: builder.build(inv, j.totalValue),
        commentsXml: builder.commentsXml,
        vmlXml: builder.vmlXml,
        totalRow,
      });
    }
    // 验证：明细行合计 vs 源表合计 × 0.967（发票上的合计以源表标注为准，这里仍比明细和，
    // 让"有其他费用加不到"的票继续亮黄提醒）
    // 单段发票：比本张；多段发票：源表页脚是各段累计合计，只对最后一段比"累计明细和"
    const own = invoiceTotal(inv);
    const isMulti = j.partCount > 1;
    const isLastPart = j.partIndex === j.partCount - 1;
    let refTotal = null, compareVal = null;
    if (inv.srcTotal !== null && inv.srcTotal !== undefined) {
      if (!isMulti) { refTotal = inv.srcTotal * 0.967; compareVal = own; }
      else if (isLastPart) { refTotal = inv.srcTotal * 0.967; compareVal = j.linesTotal; }
    }
    const diff = refTotal !== null && compareVal !== null ? compareVal - refTotal : null;
    report.push({
      name: inv.outSheetName,
      invNo: String(inv.invNo),
      date: fmtDate(inv.date),
      po: inv.po,
      lines: inv.lines.length,
      parts: isMulti ? `第${j.partIndex + 1}/${j.partCount}段` : '',
      total: j.totalValue,
      ownTotal: own,
      refTotal,
      diff,
      status: diff !== null && Math.abs(diff) > 0.02 ? 'warn' : 'ok',
      note: diff !== null && Math.abs(diff) > 0.02
        ? (isMulti ? '明细行合计与源表整单累计×0.967 差值超过 0.02（可能有明细外的其他费用，发票合计已按源表标注填）；若只选了部分段数属正常，请确认' : '明细行合计与源表合计×0.967 差值超过 0.02（可能有明细外的其他费用，发票合计已按源表标注填），请人工核对')
        : '',
    });
    done++;
    if (onProgress && done % 20 === 0) onProgress(done, jobs.length);
  }

  const output = await pkg.save();
  return { output, report, skipped, warnings, baseName };
}
