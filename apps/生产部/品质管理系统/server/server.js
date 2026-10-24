/* ══════════════════════════════════════════════════════════════
   兴信 QMS 后端服务器  ·  零依赖（Node 内置 http + node:sqlite）
   ────────────────────────────────────────────────────────────
   职责：
     1. 用 SQLite 文件库持久化 验货记录 / 账号 / 不良描述库
     2. 首次启动从 seed.json 灌入默认账号 + 不良库
     3. 提供 REST API：/api/bootstrap (拉全量)、/api/records|users|defects (全量写回)
     4. 同端口静态托管前端（index.html / app.js / ...）

   多厂区（2026-09 新增）：
     · 每个厂区一套完全独立的数据库文件：server/data/<厂区id>/qc.db
     · 数据（记录 / 账号 / 不良库）在厂区之间物理隔离、互不流通
     · 所有数据 API 通过 ?company=<厂区id> 指定目标厂区（缺省默认 dg-xingxin，兼容旧链接）
     · 旧版单库（生产：DATA_PATH/qc.db；本地：server/qc.db）首次启动自动迁移为东莞兴信库
   启动：node server.js   （默认端口 8765，可用环境变量 PORT 覆盖）
══════════════════════════════════════════════════════════════ */
'use strict';
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Auth = require('./auth');
const sessions = Auth.createSessions();

const ROOT      = path.join(__dirname, '..');           // 前端静态根目录
const DATA_DIR  = process.env.DATA_PATH || path.join(__dirname, 'data');
const LEGACY_DB = path.join(__dirname, 'qc.db');        // 本地开发的旧版单库路径（自动迁移用；生产旧库在 DATA_PATH/qc.db）
const SEED_PATH = path.join(__dirname, 'seed.json');
const AI_CONFIG_PATH = path.join(__dirname, 'ai-config.json');
const PORT      = process.env.PORT === undefined ? 8765 : Number(process.env.PORT);

/* ════════ 厂区 → 子公司清单（数据隔离边界；每家子公司一个独立库 server/data/<id>/qc.db）════════
   新增子公司：在这里加一行 + 前端 app.js 的 QC_COMPANIES 加一行即可 */
const COMPANIES = [
  /* 东莞厂区 */
  { id: 'dg-xingxin',   site: '东莞', name: '东莞兴信' },
  { id: 'dg-huadeng-a', site: '东莞', name: '东莞华登A' },
  { id: 'dg-huadeng-b', site: '东莞', name: '东莞华登B' },
  { id: 'dg-huajia',    site: '东莞', name: '东莞华嘉' },
  /* 河源厂区 */
  { id: 'hy-huakang-a', site: '河源', name: '华康A' },
  { id: 'hy-huakang-b', site: '河源', name: '华康B' },
  { id: 'hy-huakang-c', site: '河源', name: '华康C' },
  { id: 'hy-huakang-d', site: '河源', name: '华康D' },
  { id: 'hy-huadeng',   site: '河源', name: '河源华登' },
  { id: 'hy-huaxing',   site: '河源', name: '河源华兴' },
  /* 湖南厂区 */
  { id: 'sy-huadeng',   site: '湖南', name: '邵阳华登' },
  { id: 'sy-xingxin',   site: '湖南', name: '邵阳兴信' },
  { id: 'xs-huadeng',   site: '湖南', name: '新邵华登' },
];
const DEFAULT_COMPANY = 'dg-xingxin';
/* 旧版兼容：早期按厂区名当 company 的链接/缓存自动映射到该厂区默认子公司 */
const LEGACY_ALIAS = { dongguan: 'dg-xingxin', heyuan: 'hy-huakang-a', hunan: 'sy-huadeng' };

function resolveCompany(searchParams) {
  let raw = String((searchParams && searchParams.get('company')) || '').trim().toLowerCase();
  if (!raw) return DEFAULT_COMPANY;
  if (LEGACY_ALIAS[raw]) raw = LEGACY_ALIAS[raw];
  const hit = COMPANIES.find(c => c.id === raw);
  return hit ? hit.id : null;   // 非法子公司 → null → 路由返回 400
}
function companyName(id) {
  const c = COMPANIES.find(c => c.id === id);
  return c ? c.name : id;
}
function companySite(id) {
  const c = COMPANIES.find(c => c.id === id);
  return c ? c.site : id;
}

/* ════════ AI 配置（阿里百炼 / DashScope OpenAI 兼容，全局共用）════════ */
function loadAiConfig() {
  let cfg = {
    enabled: false,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    ocrModel: 'qwen3.5-omni-plus',
    textModel: 'qwen3.5-omni-plus',
  };
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8'))); }
  catch (e) { console.warn('[AI] config not loaded:', e.message); }
  // 环境变量可覆盖密钥
  const envApiKey = process.env.DASHSCOPE_API_KEY || process.env.QC_BAILIAN_API_KEY;
  if (envApiKey) cfg.apiKey = envApiKey;
  // 仅当密钥已填写真实值（非占位）才算可用
  const placeholder = !cfg.apiKey || /粘贴|你的|YOUR|xxxx|sk-xxx/i.test(cfg.apiKey) || cfg.apiKey.includes('****');
  cfg.ready = cfg.enabled !== false && !placeholder;
  return cfg;
}
let AI = loadAiConfig();

/* OCR 识别提示词：qwen3.5-ocr 官方全文识别模式。
   该模型指令遵循能力差（让它直接输出结构化 JSON 会抄 schema/示例），
   但它按官方提示词做「全文 OCR」非常准。所以：模型只负责把图变文字，
   字段提取由下面的 parseDeliveryNote() 确定性完成。 */
const OCR_READ_PROMPT = 'Read all the text in the image, including the company name, title, serial number, date, customer, and all text outside the table, then the table contents.';
/* 表格密集型单据（如台聚）全文 OCR 易乱行/复读，解析不出明细时改用此提示词重试 */
const OCR_TABLE_PROMPT = 'Read all the text in the image. Output the table contents as a markdown table with every column kept (including the quantity column and empty cells), one row per line.';
/* 第二次重试仍失败时：只要求输出货品明细表（列名固定，指令简单，命中率最高） */
const OCR_ITEMS_PROMPT = 'This is a delivery note photo. Output ONLY a markdown table of the goods rows with exactly these columns: | 订单号 | 货号 | 品名 | 数量 | 单位 |. One row per goods item. No other text.';

/* ── 送货单 OCR 文本 → 结构化字段（确定性解析，不依赖模型指令遵循）── */
function parseDeliveryNote(text) {
  const fields = { date: '', supplier: '', deliveryNo: '', orderNo: '', type: '来料', items: [] };
  let rawText = String(text || '');
  const decodeHtml = value => value.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code[0] !== '#') return { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
    const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
  const splitRow = l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => decodeHtml(c.trim()));
  /* 模型偶发输出 HTML 表格：仅在表格内部合并单元格，保留表外全文和其他 markdown 行。 */
  if (/<table[\s>]/i.test(rawText)) {
    rawText = rawText
      .split(/(<table\b[^>]*>[\s\S]*?<\/table\s*>)/gi)
      .map(part => {
        if (!/^<table\b/i.test(part)) return part.replace(/<\/?(?:p|div|h[1-6]|br)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
        const table = part.replace(/^<table\b[^>]*>/i, '').replace(/<\/table\s*>$/i, '');
        const rows = [], spans = [];
        for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
          const cells = [];
          for (let i = 0; i < spans.length; i++) {
            if (!spans[i]) continue;
            cells[i] = spans[i].value;
            if (--spans[i].remaining === 0) spans[i] = null;
          }
          let col = 0;
          for (const cell of row[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi)) {
            while (cells[col] !== undefined) col++;
            const span = name => {
              const m = cell[1].match(new RegExp('\\b' + name + '\\s*=\\s*["\']?(\\d+)', 'i'));
              return m ? Math.max(1, Math.min(100, Number(m[1]))) : 1;
            };
            const colspan = span('colspan'), rowspan = span('rowspan');
            const value = decodeHtml(cell[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
            /* 先转义原文 &，再编码列分隔符和反斜线，splitRow 只解码一次；
               保留业务名中的 |、实体字面量和反斜线，也避免被 LaTeX 拆行。 */
            const encoded = value.replace(/&/g, '&amp;').replace(/\|/g, '&#124;').replace(/\\/g, '&#92;');
            for (let i = 0; i < colspan; i++, col++) {
              cells[col] = i === 0 ? encoded : '';
              if (rowspan > 1) spans[col] = { value: cells[col], remaining: rowspan - 1 };
            }
          }
          if (cells.length) rows.push('| ' + Array.from(cells, c => c || '').join(' | ') + ' |');
        }
        return '\n' + rows.join('\n') + '\n';
      }).join('');
  }
  const lines = [], latexCells = new Map();
  const unwrapLatex = (s, latexRow) => {
    const value = s.replace(/\$\\text\{([^}]*)\}\$/g, '$1').replace(/\\text\s*\{([^}]*)\}/g, '$1');
    return (latexRow ? value.replace(/\\&/g, '&') : value).trim();
  };
  let inLatexArray = false;
  for (let s of rawText.split('\n')) {
    s = s.trim().replace(/\*\*/g, '');
    if (!s.includes('|')) s = decodeHtml(s);
    /* LaTeX 包装：\\begin{array}{l}...\\end{array} 拆成真实行；\\text{} 剥壳 */
    for (let row of s.split('\\\\')) {
      const beginsArray = /\\begin\{(?:array|tabular|aligned)\}/.test(row);
      const latexRow = inLatexArray || beginsArray || /\\text\s*\{/.test(row);
      inLatexArray = (inLatexArray || beginsArray) && !/\\end\{(?:array|tabular|aligned)\}/.test(row);
      row = row.replace(/\\begin\{array\}\{l\}/g, '').replace(/\\end\{array\}/g, '');
      const cells = [];
      if (latexRow) {
        let depth = 0, start = 0;
        for (let i = 0; i < row.length; i++) {
          if (row[i] === '\\') { i++; continue; }
          if (row[i] === '{') depth++;
          else if (row[i] === '}') depth = Math.max(0, depth - 1);
          else if (row[i] === '&' && depth === 0) { cells.push(unwrapLatex(row.slice(start, i), true)); start = i + 1; }
        }
        if (cells.length) cells.push(unwrapLatex(row.slice(start), true));
      }
      const t = unwrapLatex(row, latexRow);
      if (!t || /^```/.test(t) || /^-{3,}$/.test(t)) continue;
      if (/^\|[\s\-:|]+\|$/.test(t)) continue;   // markdown 表格分隔行
      lines.push(t);
      if (cells.length > 1) latexCells.set(t, cells.filter(Boolean));
    }
  }
  const joined = lines.join('\n');

  /* 日期：发货/送货/来料日期：2026-09-10 | 2026年9月10日 | 2026/9/10 */
  let m = joined.match(/(?:日期|DATE)\s*[：:]\s*(\d{4})\s*[-年\/.]\s*(\d{1,2})\s*[-月\/.]\s*(\d{1,2})/i);
  if (m) fields.date = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  /* 两位年份日期：日期: 26/09/23（默认 年/月/日，月份超 12 则按 日/月/年） */
  if (!fields.date) {
    m = joined.match(/(?:日期|DATE)\s*[：:]\s*(\d{2})\s*[\/.]\s*(\d{1,2})\s*[\/.]\s*(\d{1,2})(?!\d)/i);
    if (m) {
      let y = m[1], mo = m[2], d = m[3];
      if (Number(mo) > 12 && Number(d) <= 12) { const t2 = mo; mo = d; d = t2; }
      fields.date = '20' + y.padStart(2, '0') + '-' + mo.padStart(2, '0') + '-' + d.padStart(2, '0');
    }
  }
  /* 无标签日期兜底：开头区域独立出现的「2026年10月5日」 */
  if (!fields.date) {
    m = lines.slice(0, 15).join('\n').match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) fields.date = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  }

  /* 送货单号：送货单号/发货单号/单号/NO. */
  const deliveryLabels = /(?:送\s*[货貨]\s*[单單]\s*[号號]|[发發]\s*[货貨]\s*[单單]\s*[号號]|[单單]\s*[号號]|NO\.?)\s*[：:]\s*([A-Za-z0-9][A-Za-z0-9.\-\/]{3,})/ig;
  for (const candidate of joined.matchAll(deliveryLabels)) {
    if (/[订訂]\s*$/.test(joined.slice(0, candidate.index))) continue;   /* 订单号/訂單號不属于送货单号 */
    fields.deliveryNo = candidate[1]; break;
  }
  /* 无标签单号兜底：开头独立成行的 4-8 位流水号（排除年份，进表格即停） */
  if (!fields.deliveryNo) {
    for (const ln of lines.slice(0, 12)) {
      const t = ln.trim();
      if (t.startsWith('|')) break;
      if (/^[A-Za-z]{2,6}[.\-]\d{4,}$/.test(t)) { fields.deliveryNo = t; break; }   /* 字母前缀流水号（DGHD.2673728） */
      if (/^\d{4,8}$/.test(t) && !/^(19|20)\d{2}$/.test(t)) { fields.deliveryNo = t; break; }
    }
  }

  /* 供应商：开头几行里含「公司/厂」且不是收货方/标题/地址的（pipe/LaTeX & 分隔都拆开看） */
  for (const ln of lines.slice(0, 8)) {
    const cells = (ln.includes('|') ? splitRow(ln) : latexCells.get(ln) || [ln.replace(/^#+\s*/, '').trim()]).filter(Boolean);
    for (const t of cells) {
      if (!t || t === '送货单' || t === '送貨單' || /客户|客戶|收货|收貨|寶號|Messrs|地址|电话|電話| Tel/i.test(t)) continue;
      if (/公司|工厂|工廠|制品厂|製品廠|纸品厂|紙品廠/.test(t) && t.length >= 6 && t.length <= 40) { fields.supplier = t; break; }
    }
    if (fields.supplier) break;
  }
  /* 无「公司」字样兜底：开头第一个有意义的行（如「攀登」） */
  if (!fields.supplier) {
    for (const ln of lines.slice(0, 6)) {
      let t = ln.replace(/^#+\s*/, '').trim();
      t = t.replace(/^&+\s*/, '').trim();
      if (!t || t === '送货单' || t === '送貨單' || t === fields.deliveryNo || t.startsWith('|') || /[{\\]/.test(t)) continue;
      if (/客户|客戶|收货|收貨|日期|单号|單號|NO\.?|地址|电话|電話|备注|備注| Tel|DATE|DELIVERY|MESSRS|^\d/i.test(t)) continue;
      if (/[：:]$/.test(t)) continue;
      if (/^(货号|貨號|品名|名称|名稱|数量|數量|单位|單位|订单号|訂單號|备注|備注|序号|序號|送货单|送貨單)$/.test(t)) continue;
      if (t.length >= 2 && t.length <= 20) { fields.supplier = t; break; }
    }
  }

  /* markdown 表格 → items（列按表头关键词映射）；不以 | 开头但含 ≥3 个竖线的行也算（恒新昌单行表格） */
  const tbl = lines.filter(l => l.startsWith('|') || (l.match(/\|/g) || []).length >= 3);
  if (tbl.length >= 2) {
    const hi = tbl.findIndex(l => /编号|編號|货号|貨號|品名|名称|名稱|货名|貨名|数量|數量|订单|訂單/.test(l) && !(/[：:]/.test(l) && /客户|客戶|收货|收貨|地址|电话|電話|单号|單號|日期/.test(l)));   /* 只排除带冒号的标签行，保留「客户订单号」等合法列名 */
    if (hi !== -1) {
      const head = splitRow(tbl[hi]);
      const find = (re, notRe) => head.findIndex(h => re.test(h) && !(notRe && notRe.test(h)));
      let   cOrder = find(/合同/, /数量|數量/);
      if (cOrder === -1) cOrder = find(/订单|訂單|PO/i, /数量|數量/);
      const cNo    = find(/编号|編號|货号|貨號|Item/i, /订单|訂單|合同/);
      let   cName  = find(/品名|名称|名稱|货名|貨名|规格|規格|Desc/i, /编号|編號|货号|貨號/);
      let splitNameHdr = false;
      if (cName === -1) { cName = head.findIndex((h, i) => /^(貨|货)$/.test(h) && head[i + 1] === '名'); splitNameHdr = cName !== -1; }   /* 「貨|名」分两列的表头（华登） */
      let   cQty   = head.findIndex(h => /^(数|數)\s*量$/.test(h));
      if (cQty === -1) cQty = find(/交货数量|交貨數量|到货数量|到貨數量|送货数量|送貨數量|实送数量|實送數量/);
      if (cQty === -1) cQty = find(/送货|送貨|实送|實送/, /欠|总|總/);
      if (cQty === -1) cQty = find(/数量|數量/, /欠|总|總/);
      if (cQty === -1) cQty = find(/备品|備品/);   /* 台聚：模型偶发丢「数量」表头，数量值落在备品数列 */
      const cUnit  = find(/单位|單位/, /数量|數量/);
      let lastNo = '';
      for (const row of tbl.slice(hi + 1)) {
        const cells = splitRow(row);
        const raw = i => (i >= 0 && i < cells.length ? cells[i] : '');
        const numeric = v => /^\d[\d,.]*(?:\s*\/.*)?$/.test(v);
        /* 合并品名格会令后续所有列左移；短一格时即便下一列金额也是数字，也应按行宽校正。 */
        const shifted = splitNameHdr && cQty > cName && numeric(raw(cQty - 1)) &&
          (cells.length === head.length - 1 || !numeric(raw(cQty)));
        const get = i => raw(shifted && i > cName ? i - 1 : i);
        let no = get(cNo), name = get(cName);
        const mappedName = name;
        const qtyCell = get(cQty);
        let qty = qtyCell.split('/')[0].replace(/[^\d.]/g, '');
        if (!name) {   /* 品名被 OCR 错放到别的列：找第一个像品名的格子 */
          for (const c of cells) {
            if ((c.match(/[一-鿿]/g) || []).length >= 2 && !/^\d+\s*色/.test(c) && !/[：:]/.test(c)) { name = c; break; }
          }
        }
        if (!no && !name) continue;
        if (/^(序|NO\.?|ITEM(?:\s+NO\.?)?)$/i.test(no)) continue;   /* 复读出的第二遍表头（ITEM NO. 等） */
        if (/^(DESCRIPTION|品名|名称|名稱|货名|貨名)$/i.test(name)) continue;
        if (/[：:]/.test(no) || /[：:]/.test(name)) continue;   /* 表尾标签行（胶箱：/收货人：/Q.C: 等） */
        if (!get(cQty) && /^(备注|備注|说明|說明)$/.test(no || name)) continue;
        if (!mappedName && /^(胶箱|膠箱|胶袋|膠袋|纸箱|紙箱|平卡|卡板|吸塑|钙箱|鈣箱|周转箱)$/.test(no)) continue;   /* 包装标签占货号格且品名为空的表尾统计；包装材料货品仍保留 */
        if (/^(合计|总计|合計|總計)/.test(no) || /^(合计|总计|合計|總計)/.test(name)) continue;   /* 合计行 */
        if (/^[-—–=]+$/.test(no) || /^[-—–=]+$/.test(name)) continue;   /* 分隔线碎片行 */
        if (!qty && !/\s\d{2,}$/.test(name) && /查验|签收|收妥|逾期|差错|通知|不负责|拒不退换/.test(name)) continue;   /* 无货品数量依据的表尾说明；签收贴纸等正常货品保留 */
        if (!no && !get(cQty) && /^[A-Za-z0-9][A-Za-z0-9\-_.]{5,}$/.test(name) && /\d/.test(name)) {
          if (!fields.orderNo) fields.orderNo = name;
          continue;   /* 这不是明细行，是订单号被错放进来了 */
        }
        /* 货号/品名错位互换：货号格是中文、品名格是编号串时对调 */
        if (/[一-鿿]/.test(no) && /^[A-Za-z0-9#+\-.]+$/.test(name)) { const tmp = no; no = name; name = tmp; }
        /* 品名规格开头带编号（如「77772-8#唱片背面贴纸」）：拆出编号当货号 */
        if (!no && name) {
          const pm = name.match(/^([A-Za-z0-9][A-Za-z0-9#\-]{2,})[一-鿿]/);
          if (pm) { no = pm[1]; name = name.slice(pm[1].length); }
        }
        if (/-+$/.test(no)) no = no.replace(/-+$/, '');   /* 货号尾部多余横杠（77772- → 77772） */
        if (!no) no = lastNo;   /* 合并单元格：货号向下继承 */
        if (no) lastNo = no;
        if (!qty && /\s\d{2,}$/.test(name)) {   /* 品名尾部粘了数量（袋 4500） */
          const qm = name.match(/^(.*?)\s+(\d{2,})$/);
          if (qm) { name = qm[1]; qty = qm[2]; }
        }
        if (!qty && !name) continue;   /* 无数量又无品名，不是明细行 */
        let   unit = get(cUnit);
        /* 表头合并了「送货数量单位」时，单位在数量右边一格 */
        const nextCell = get(cQty + 1);
        if (!unit && cQty >= 0 && nextCell && !/\d/.test(nextCell) && nextCell.length <= 4) unit = nextCell;
        if (!fields.orderNo) { const o = get(cOrder).replace(/\s+/g, ''); if (o && o !== no && o.length >= 6) fields.orderNo = o; }
        fields.items.push({ productNo: no, productName: name, qty, unit });
      }
    }
  }

  /* 只有一条 pipe 数据行、没有表头（恒新昌）：启发式取 订单号/品名/数量 */
  if (!fields.items.length && tbl.length === 1) {
    const cells = splitRow(tbl[0]);
    if (cells.length >= 4) {
      const header = /^(订单号|訂單號|货号|貨號|品名|名称|名稱|数量|數量|单位|單位|备注|備注|日期|客户|客戶|供应商|供應商|送货单|送貨單)$/;
      const nameIndex = cells.findIndex(c => (c.match(/[一-鿿]/g) || []).length >= 2 && !/^\d+\s*色/.test(c) && !/[：:]/.test(c) && !header.test(c));
      let name = nameIndex >= 0 ? cells[nameIndex] : '', qty = '', unit = '';
      const number = c => /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(c);
      const quantityUnit = /^(个|個|PCS|件|套|卷|张|張|桶|KG|米|箱|包|条|條|颗|顆)$/i;
      /* 无表头时仅接受品名后的数量/单位相邻格；订单号、货号和金额不能凭数字外形当数量。 */
      const candidates = [];
      for (let i = nameIndex + 1; nameIndex >= 0 && i < cells.length; i++) {
        if (!number(cells[i])) continue;
        if (quantityUnit.test(cells[i + 1] || '')) candidates.push({ qty: cells[i].replace(/,/g, ''), unit: cells[i + 1] });
        else if (i > nameIndex + 1 && quantityUnit.test(cells[i - 1])) candidates.push({ qty: cells[i].replace(/,/g, ''), unit: cells[i - 1] });
      }
      if (candidates.length === 1) ({ qty, unit } = candidates[0]);
      let no = '';
      if (name) {
        const pm = name.match(/^([A-Za-z0-9][A-Za-z0-9#\-]{2,})[一-鿿]/);
        if (pm) { no = pm[1]; name = name.slice(pm[1].length); }
      }
      if (!no && nameIndex > 1 && /^[A-Za-z0-9][A-Za-z0-9#\-]{2,}$/.test(cells[nameIndex - 1]) && /\d/.test(cells[nameIndex - 1])) no = cells[nameIndex - 1];
      if (!fields.orderNo && /^[A-Za-z0-9][A-Za-z0-9\-]{5,}$/.test(cells[0])) fields.orderNo = cells[0];
      if (name && qty) fields.items.push({ productNo: no, productName: name, qty, unit });
    }
  }

  /* 非 markdown 表格兜底：表头行（品名+数量）之后的行，行尾找「数量+单位」 */
  if (!fields.items.length) {
    const hiP = lines.findIndex(l => !l.startsWith('|') && /品名|名称|名稱|货名|貨名/.test(l) && /数量|數量/.test(l));
    if (hiP !== -1) {
      let lastNoP = '';
      for (const ln of lines.slice(hiP + 1)) {
        let m2 = ln.match(/^(.*?)\s+(\d{1,3}(?:,\d{3})+|\d{2,})\s+(个|PCS|pcs|件|套|卷|张|張|桶|KG|kg|米|箱|包|条|條|颗|顆)(?=\s|$)/);
        if (!m2) {
          /* 单位在数量前（港正/莞力/鸿滨洋）：捕获组换成同序（前缀/数量/单位） */
          const ma = ln.match(/^(.*?)\s+(个|PCS|pcs|件|套|卷|张|張|桶|KG|kg|米|箱|包|条|條|颗|顆)\s+(\d{1,3}(?:,\d{3})+|\d{2,})(?=\s|$)/);
          if (ma) m2 = [ma[0], ma[1], ma[3], ma[2]];
        }
        if (!m2) continue;
        const tokens = m2[1].trim().split(/\s+/);
        let no = '', name = '';
        /* 订单号样式 token（字母+数字+横杠，如 BB2026116-BN008），排除出货号候选 */
        if (!fields.orderNo) {
          for (const t of tokens) {
            if (/[A-Za-z]/.test(t) && /\d/.test(t) && t.includes('-') && t.length >= 6) { fields.orderNo = t; break; }
          }
        }
        /* 货号：优先选不含中文、长度≥5、含数字、不以 - 结尾（排除单号碎片）的 token */
        for (const t of tokens) {
          if (no) break;
          if (t.endsWith('-')) continue;
          if (/^[\w#]{5,}$/.test(t) && /\d/.test(t) && t !== m2[2]) no = t;
        }
        if (!no) for (const t of tokens) { if (/[A-Za-z#]/.test(t) && t.length >= 4) { no = t; break; } }
        /* 品名：中文字符≥2 的最长 token（排除颜色等数字开头的规格串，如「7726黑色」） */
        const cjk = tokens.filter(t => (t.match(/[\u4e00-\u9fff]/g) || []).length >= 2 && !/^\d/.test(t));
        if (cjk.length) name = cjk.reduce((a, b) => (a.length >= b.length ? a : b));
        if (!no) no = lastNoP;   /* 合并单元格：货号向下继承 */
        if (no) lastNoP = no;
        if (!no && !name) continue;
        fields.items.push({ productNo: no, productName: name, qty: m2[2].replace(/,/g, ''), unit: m2[3] });
      }
    }
  }

  /* 表格外订单号兜底 */
  if (!fields.orderNo) {
    m = joined.match(/(?:[订訂]\s*[单單]\s*(?:[号號]|[编編]\s*[号號])|PO\s*[号號]?)\s*[：:]\s*([A-Za-z0-9][A-Za-z0-9\-]{3,})/i);
    if (m) fields.orderNo = m[1];
  }

  /* 模型偶发「复读」：把同一行明细输出多次，甚至整份单据重复 N 遍。
     两级去重：完全相同的行只留一条；品名+数量+单位仍重复的行只保留第一次出现
     （复读时碎片行的货号会不同，如把条码当成货号，第一次出现的完整行最可靠）。 */
  if (fields.items.length > 1) {
    const seen = new Set();
    fields.items = fields.items.filter(it => {
      const k = [it.productNo, it.productName, it.qty, it.unit].join('|');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    /* 品名做 OCR 易混字符归一（1/I/l、0/O、5/S）再合并：
       复读时同一行可能被识别成「1L」和「IL」两个版本 */
    const normName = n => String(n || '').replace(/[Il|]/g, '1').replace(/[Oo]/g, '0').replace(/[Ss]/g, '5').replace(/\s+/g, '');
    const seenLoose = new Set();
    fields.items = fields.items.filter(it => {
      if (!it.productName || !it.qty) return true;   /* 信息不全的行不参与合并 */
      const k = [normName(it.productName), it.qty, it.unit].join('|');
      if (seenLoose.has(k)) return false;
      seenLoose.add(k); return true;
    });
    /* 只合并大小写/繁简单位差异，箱、个等不同计量单位不能作为复读删除。 */
    const normUnit = u => String(u || '').replace(/\s+/g, '').toUpperCase().replace(/個/g, '个').replace(/張/g, '张').replace(/條/g, '条').replace(/顆/g, '颗');
    const seenStrict = new Set();
    fields.items = fields.items.filter(it => {
      if (!it.productNo || !it.productName || !it.qty) return true;
      const k = [it.productNo, normName(it.productName), it.qty, normUnit(it.unit)].join('|');
      if (seenStrict.has(k)) return false;
      seenStrict.add(k); return true;
    });
    /* 无数量的复读残行：同货号+品名已有带数量的完整行则丢弃 */
    const withQty = new Set(fields.items.filter(i => i.qty).map(i => [i.productNo, normName(i.productName)].join('|')));
    fields.items = fields.items.filter(it => it.qty || !withQty.has([it.productNo, normName(it.productName)].join('|')));
  }
  return fields;
}

/* 调用视觉模型（OpenAI 兼容）做全文 OCR，再确定性解析字段 */
async function aiVisionExtract(dataUrl) {
  if (!AI.ready) {
    const err = new Error('AI 未配置：请在 server/ai-config.json 填入阿里百炼 API Key 后调用 /api/ai/reload');
    err.code = 'NO_AI'; throw err;
  }
  const payload = {
    model: AI.ocrModel || 'qwen3.5-ocr',
    temperature: 0,
    max_tokens: 4096,   /* OpenRouter 按 max_tokens 预扣额度，不设上限易触发 402 */

    messages: [
      { role: 'user', content: [
        { type: 'text', text: OCR_READ_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ],
  };
  async function callModel(model) {
    payload.model = model;
    const resp = await fetch(AI.baseURL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI.apiKey },
      body: JSON.stringify(payload),
    });
    return { status: resp.status, raw: await resp.text() };
  }
  /* 该密钥的模型权限存在随机抖动（同一请求约 40~60% 概率返回 403 AccessDenied），
     因此对 403 做同模型重试（最多 6 次，间隔 1.5s）；仍失败再回退 qwen3.5-ocr */
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const isDenied = x => x.status === 403 && /denied|Unpurchased/i.test(x.raw);
  let r = await callModel(payload.model);
  for (let i = 0; i < 5 && isDenied(r); i++) {
    console.warn('[AI] 模型 %s 403（第 %d 次），1.5s 后重试', payload.model, i + 1);
    await sleep(1500);
    r = await callModel(payload.model);
  }
  if (isDenied(r) && payload.model !== 'qwen3.5-ocr') {
    console.warn('[AI] 模型 %s 持续无权限，回退 qwen3.5-ocr', payload.model);
    r = await callModel('qwen3.5-ocr');
    for (let i = 0; i < 2 && isDenied(r); i++) {
      await sleep(1500);
      r = await callModel('qwen3.5-ocr');
    }
  }
  const raw = r.raw;
  if (r.status >= 400) { const err = new Error('百炼返回 HTTP ' + r.status + '：' + raw.slice(0, 600)); err.code = 'UPSTREAM'; throw err; }
  let data; try { data = JSON.parse(raw); } catch (e) { throw new Error('百炼响应非 JSON：' + raw.slice(0, 300)); }
  let content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
  if (Array.isArray(content)) content = content.map(c => (typeof c === 'string' ? c : (c && c.text) || '')).join('');
  content = String(content).trim();
  let fields = parseDeliveryNote(content);
  /* 表格密集型单据（如台聚）全文 OCR 易乱行/复读导致解析不出明细：
     换「输出 markdown 表格」提示词再识别一次，解析出明细才采用 */
  if (!fields.items.length) {
    console.warn('[AI] 首次 OCR 未解析出明细，换表格提示词重试');
    payload.messages[0].content[0].text = OCR_TABLE_PROMPT;
    let r2 = await callModel(payload.model);
    for (let i = 0; i < 3 && isDenied(r2); i++) { await sleep(1500); r2 = await callModel(payload.model); }
    if (r2.status < 400) {
      try {
        const data2 = JSON.parse(r2.raw);
        let content2 = data2 && data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content || '';
        if (Array.isArray(content2)) content2 = content2.map(c => (typeof c === 'string' ? c : (c && c.text) || '')).join('');
        content2 = String(content2).trim();
        const fields2 = parseDeliveryNote(content2);
        if (fields2.items.length) {
          if (!fields2.date && fields.date) fields2.date = fields.date;
          if (!fields2.supplier && fields.supplier) fields2.supplier = fields.supplier;
          if (!fields2.deliveryNo && fields.deliveryNo) fields2.deliveryNo = fields.deliveryNo;
          if (!fields2.orderNo && fields.orderNo) fields2.orderNo = fields.orderNo;
          fields = fields2; content = content2; data = data2;
        }
      } catch (e) { console.warn('[AI] 表格提示词重试响应异常：', e.message); }
    }
    /* 仍无明细：第三次，只让模型输出货品明细表（列名固定） */
    if (!fields.items.length) {
      console.warn('[AI] 二次重试仍无明细，换明细表提示词再试');
      payload.messages[0].content[0].text = OCR_ITEMS_PROMPT;
      let r3 = await callModel(payload.model);
      for (let i = 0; i < 3 && isDenied(r3); i++) { await sleep(1500); r3 = await callModel(payload.model); }
      if (r3.status < 400) {
        try {
          const data3 = JSON.parse(r3.raw);
          let content3 = data3 && data3.choices && data3.choices[0] && data3.choices[0].message && data3.choices[0].message.content || '';
          if (Array.isArray(content3)) content3 = content3.map(c => (typeof c === 'string' ? c : (c && c.text) || '')).join('');
          content3 = String(content3).trim();
          const fields3 = parseDeliveryNote(content3);
          if (fields3.items.length) {
            if (!fields3.date && fields.date) fields3.date = fields.date;
            if (!fields3.supplier && fields.supplier) fields3.supplier = fields.supplier;
            if (!fields3.deliveryNo && fields.deliveryNo) fields3.deliveryNo = fields.deliveryNo;
            if (!fields3.orderNo && fields.orderNo) fields3.orderNo = fields.orderNo;
            fields = fields3; content = content3; data = data3;
          }
        } catch (e) { console.warn('[AI] 明细表提示词重试响应异常：', e.message); }
      }
    }
  }
  return { fields, usage: data.usage || null, rawText: content };
}

/* ── 记录表列顺序（写入/读取都按这个顺序）── */
const RECORD_COLS = [
  'id', 'date', 'inspDate', 'supplier', 'client', 'processType', 'productNo', 'productName',
  'deliveryNo', 'orderNo', 'type', 'qty', 'sampleQty', 'pass', 'fail',
  'defectRate', 'result', 'result2', 'defect', 'defects', 'measurements',
  'qc', 'confirmBy', 'remark', 'orderQty', 'updatedAt',
  'status', 'reviewBy', 'reviewAt', 'rejectReason', 'rejectBy', 'rejectAt',
  'aqlLevel',
];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    date TEXT, inspDate TEXT, supplier TEXT, client TEXT, processType TEXT,
    productNo TEXT, productName TEXT, deliveryNo TEXT, orderNo TEXT,
    type TEXT, qty INTEGER, sampleQty INTEGER, pass INTEGER, fail INTEGER,
    defectRate TEXT, result TEXT, result2 TEXT, defect TEXT,
    defects TEXT, measurements TEXT,
    qc TEXT, confirmBy TEXT, remark TEXT, orderQty INTEGER, updatedAt TEXT,
    status TEXT, reviewBy TEXT, reviewAt TEXT,
    rejectReason TEXT, rejectBy TEXT, rejectAt TEXT,
    aqlLevel TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, password TEXT, role TEXT,
    enabled INTEGER, createdAt TEXT, lastLoginAt TEXT
  );
  CREATE TABLE IF NOT EXISTS defect_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, category TEXT, defaultLevel TEXT,
    keywords TEXT, enabled INTEGER, createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, type TEXT, createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS record_tombstones (
    id INTEGER PRIMARY KEY, deletedAt TEXT
  );
`;

const toNum = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
const j     = (v) => JSON.stringify(Array.isArray(v) ? v : (v ? [v] : []));

function recordValues(r) {
  return [
    toNum(r.id), r.date ?? null, r.inspDate ?? null, r.supplier ?? null, r.client ?? null, r.processType ?? null,
    r.productNo ?? null, r.productName ?? null, r.deliveryNo ?? null, r.orderNo ?? null,
    r.type ?? null, toNum(r.qty), toNum(r.sampleQty), toNum(r.pass), toNum(r.fail),
    r.defectRate ?? null, r.result ?? null, r.result2 ?? null, r.defect ?? null,
    j(r.defects), j(r.measurements),
    r.qc ?? null, r.confirmBy ?? null, r.remark ?? null, toNum(r.orderQty),
    r.updatedAt || new Date().toISOString(),
    r.status ?? null, r.reviewBy ?? null, r.reviewAt ?? null,
    r.rejectReason ?? null, r.rejectBy ?? null, r.rejectAt ?? null,
    r.aqlLevel ?? null,
  ];
}

function rowToRecord(row) {
  const r = Object.assign({}, row);
  try { r.defects = JSON.parse(row.defects || '[]'); } catch (e) { r.defects = []; }
  try { r.measurements = JSON.parse(row.measurements || '[]'); } catch (e) { r.measurements = []; }
  return r;
}

function nextRecordId(db) {
  const row = db.prepare('SELECT MAX(id) AS id FROM (SELECT id FROM records UNION ALL SELECT id FROM record_tombstones)').get();
  return Math.max(30, Number(row.id) || 0) + 1;
}

/* ── 合并写入（事务）：按 id upsert。
   多人/多标签页同时使用时，任何一端都可能用「旧状态的全量数组」推回服务端，
   旧的全量替换会把别人新录的记录整批抹掉（曾发生 74 条变 68 条）。
   规则：
   1) 同 id 已存在且服务端 updatedAt 更新 → 跳过这条（旧数据不覆盖新数据）；
   2) 命中墓碑 → 跳过；仅显式整库替换可以重用已删除编号；
   3) 其余 INSERT ... ON CONFLICT UPDATE。 ── */
function upsertRecords(db, records, transaction = true) {
  const cols = RECORD_COLS.join(',');
  const ph = RECORD_COLS.map(() => '?').join(',');
  const upd = RECORD_COLS.filter(c => c !== 'id').map(c => c + '=excluded.' + c).join(',');
  const ins = db.prepare(`INSERT INTO records(${cols}) VALUES(${ph}) ON CONFLICT(id) DO UPDATE SET ${upd}`);
  const get = db.prepare('SELECT updatedAt FROM records WHERE id = ?');
  const getTomb = db.prepare('SELECT deletedAt FROM record_tombstones WHERE id = ?');
  let accepted = 0, skippedStale = 0, skippedTomb = 0;
  if (transaction) db.exec('BEGIN');
  try {
    for (const r of records) {
      const id = Number(r.id) || 0;
      if (!id) continue;
      const tomb = getTomb.get(id);
      // Only the explicit replacement channel may reuse a deleted id. A stale
      // browser's clock may be ahead of the server's deletion timestamp.
      if (tomb) { skippedTomb++; continue; }
      const cur = get.get(id);
      if (cur && cur.updatedAt && (!r.updatedAt || !Number.isFinite(Date.parse(r.updatedAt)) ||
          Date.parse(cur.updatedAt) >= Date.parse(r.updatedAt))) { skippedStale++; continue; }
      ins.run(...recordValues(r));
      accepted++;
    }
    if (transaction) db.exec('COMMIT');
  } catch (e) { if (transaction) db.exec('ROLLBACK'); throw e; }
  return { accepted, skippedStale, skippedTomb };
}

/* ── 按 id 删除（写墓碑，防止旧标签页推送复活）── */
function deleteRecords(db, ids, transaction = true) {
  const now = new Date().toISOString();
  const del = db.prepare('DELETE FROM records WHERE id = ?');
  const tomb = db.prepare('INSERT OR REPLACE INTO record_tombstones(id, deletedAt) VALUES(?, ?)');
  let count = 0;
  if (transaction) db.exec('BEGIN');
  try {
    for (const id of ids) {
      const n = Number(id) || 0;
      if (!n) continue;
      del.run(n); tomb.run(n, now); count++;
    }
    if (transaction) db.exec('COMMIT');
  } catch (e) { if (transaction) db.exec('ROLLBACK'); throw e; }
  return count;
}

function mergeRecordChanges(db, records, ids) {
  db.exec('BEGIN');
  try {
    const deleted = deleteRecords(db, ids, false);
    const result = upsertRecords(db, records, false);
    db.exec('COMMIT');
    return { ...result, deleted };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/* ── 全量替换（事务）：仅用于「清空数据 / 恢复示例 / 替换模式导入」等显式整库操作 ── */
function replaceRecords(db, records) {
  const ph = RECORD_COLS.map(() => '?').join(',');
  const ins = db.prepare(`INSERT INTO records(${RECORD_COLS.join(',')}) VALUES(${ph})`);
  db.exec('BEGIN');
  try {
    // Keep tombstones for records omitted by a clear/import, so an old tab
    // cannot undo the explicit replacement on its next ordinary save.
    db.prepare('INSERT OR REPLACE INTO record_tombstones(id,deletedAt) SELECT id,? FROM records').run(new Date().toISOString());
    db.prepare('DELETE FROM records').run();
    const clearTomb = db.prepare('DELETE FROM record_tombstones WHERE id=?');
    for (const r of records) { ins.run(...recordValues(r)); clearTomb.run(toNum(r.id)); }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function replaceUsers(db, users) {
  migrateUsersTable(db);
  const ins = db.prepare('INSERT INTO users(username,password,role,enabled,createdAt,lastLoginAt,name,dept,perms) VALUES(?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM users').run();
    for (const u of users) ins.run(
      u.username, u.password ?? null, u.role ?? 'viewer', u.enabled ? 1 : 0,
      u.createdAt ?? null, u.lastLoginAt ?? null,
      u.name ?? null, u.dept ?? null,
      u.perms ? (typeof u.perms === 'string' ? u.perms : JSON.stringify(u.perms)) : null,
    );
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  ensureSuperAdmin(db);
}

/* 保底：主账号 jc 在任何子公司都不能被删除/停用（确保管理员永远进得去） */
function ensureSuperAdmin(db) {
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const jc = (seed.users || []).find(u => u.username === 'jc');
    if (!jc) return;
    const cur = db.prepare("SELECT * FROM users WHERE username='jc'").get();
    if (!cur) {
      db.prepare('INSERT INTO users(username,password,role,enabled,createdAt,lastLoginAt) VALUES(?,?,?,1,?,NULL)')
        .run('jc', jc.password ?? null, 'admin', new Date().toISOString());
      console.log('[保底] jc 主账号被删除，已自动恢复');
    } else if (!cur.enabled || cur.role !== 'admin') {
      db.prepare("UPDATE users SET enabled=1, role='admin' WHERE username='jc'").run();
      console.log('[保底] jc 主账号被停用/降权，已自动恢复');
    }
  } catch (e) { console.warn('[保底] jc 主账号检查失败：', e.message); }
}

/* 供应商&客户名单（全量替换） */
function replacePartners(db, list) {
  const ins = db.prepare('INSERT INTO partners(name,type,createdAt) VALUES(?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM partners').run();
    for (const p of list) ins.run(p.name ?? null, p.type ?? null, p.createdAt ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function replaceDefects(db, lib) {
  const ins = db.prepare('INSERT INTO defect_library(name,category,defaultLevel,keywords,enabled,createdAt) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM defect_library').run();
    for (const d of lib) ins.run(d.name ?? null, d.category ?? null, d.defaultLevel ?? null, JSON.stringify(d.keywords || []), d.enabled ? 1 : 0, d.createdAt ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ── 首次启动灌种子（仅在对应表为空时）──
   includeRecords=false 时只灌默认账号 + 不良库（用于新厂区，不带示例验货记录） */
function seedIfEmpty(db, { includeRecords = true } = {}) {
  let seed = { records: [], users: [], defectLib: [] };
  try { seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')); }
  catch (e) { console.warn('[seed] 读取 seed.json 失败，跳过灌种子：', e.message); }

  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0 && seed.users?.length) {
    replaceUsers(db, seed.users);
    console.log('[seed] 灌入默认账号', seed.users.length, '个');
  }
  if (includeRecords && db.prepare('SELECT COUNT(*) c FROM records').get().c === 0 && seed.records?.length) {
    replaceRecords(db, seed.records);
    console.log('[seed] 灌入验货记录', seed.records.length, '条');
  }
  if (db.prepare('SELECT COUNT(*) c FROM defect_library').get().c === 0 && seed.defectLib?.length) {
    replaceDefects(db, seed.defectLib);
    console.log('[seed] 灌入不良描述库', seed.defectLib.length, '条');
  }
}

/* 用户表新增字段（姓名/部门/权限矩阵），老库自动补齐 */
const USER_EXTRA_COLS = [
  { col: 'name',  ddl: "ALTER TABLE users ADD COLUMN name TEXT" },
  { col: 'dept',  ddl: "ALTER TABLE users ADD COLUMN dept TEXT" },
  { col: 'perms', ddl: "ALTER TABLE users ADD COLUMN perms TEXT" },
];
function migrateUsersTable(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  for (const c of USER_EXTRA_COLS) {
    if (!cols.includes(c.col)) { try { db.exec(c.ddl); } catch (e) {} }
  }
}

/* 记录表新增字段（加工类型），老库自动补齐 */
const RECORD_EXTRA_COLS = [
  { col: 'processType',  ddl: "ALTER TABLE records ADD COLUMN processType TEXT" },
  { col: 'status',       ddl: "ALTER TABLE records ADD COLUMN status TEXT" },
  { col: 'reviewBy',     ddl: "ALTER TABLE records ADD COLUMN reviewBy TEXT" },
  { col: 'reviewAt',     ddl: "ALTER TABLE records ADD COLUMN reviewAt TEXT" },
  { col: 'rejectReason', ddl: "ALTER TABLE records ADD COLUMN rejectReason TEXT" },
  { col: 'rejectBy',     ddl: "ALTER TABLE records ADD COLUMN rejectBy TEXT" },
  { col: 'rejectAt',     ddl: "ALTER TABLE records ADD COLUMN rejectAt TEXT" },
  { col: 'aqlLevel',     ddl: "ALTER TABLE records ADD COLUMN aqlLevel TEXT" },
];
function migrateRecordsTable(db) {
  const cols = db.prepare("PRAGMA table_info(records)").all().map(c => c.name);
  for (const c of RECORD_EXTRA_COLS) {
    if (!cols.includes(c.col)) { try { db.exec(c.ddl); } catch (e) {} }
  }
}

/* ════════ 多厂区数据库管理（每厂区一个独立 qc.db，懒加载 + 缓存）════════ */
const _dbs = new Map();

/* 旧版单库迁移：旧 qc.db → data/dg-xingxin/qc.db（仅首次）。
   旧库可能的位置：生产容器是 DATA_PATH/qc.db（/app/data/qc.db，bind-mount 持久卷），
   本地开发是 server/qc.db（server.js 同目录）。两处都要看，漏掉生产路径会导致
   上线后旧数据"消失"（文件还在 data/qc.db 但没人读）。 */
function migrateLegacyDb() {
  try {
    const dgDir = path.join(DATA_DIR, DEFAULT_COMPANY);
    const dgDb  = path.join(dgDir, 'qc.db');
    if (fs.existsSync(dgDb)) return;
    const candidates = [path.join(DATA_DIR, 'qc.db'), LEGACY_DB];
    const legacy = candidates.find(p => fs.existsSync(p));
    if (legacy) {
      fs.mkdirSync(dgDir, { recursive: true });
      fs.renameSync(legacy, dgDb);
      console.log('[迁移] 旧版数据库已迁移为东莞兴信库：' + legacy + ' → ' + dgDb);
    }
  } catch (e) {
    console.error('[迁移] 旧版数据库迁移失败：', e.message);
  }
}

function getDb(companyId) {
  if (_dbs.has(companyId)) return _dbs.get(companyId);
  const dir = path.join(DATA_DIR, companyId);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'qc.db');
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrateUsersTable(db);   /* 老库补齐 姓名/部门/权限 列 */
  migrateRecordsTable(db); /* 老库补齐 加工类型 列 */
  // 东莞老库已带数据则无需灌种子；全新厂区只灌账号 + 不良库，不带示例记录
  seedIfEmpty(db, { includeRecords: companyId === DEFAULT_COMPANY });
  _dbs.set(companyId, db);
  console.log('[DB] 厂区「' + companyName(companyId) + '」数据库就绪：' + dbPath);
  return db;
}

migrateLegacyDb();

/* ════════ 读取全量（供前端开机预加载）════════ */
function getBootstrap(db) {
  const records = db.prepare('SELECT * FROM records ORDER BY id').all().map(rowToRecord);
  const nextId  = nextRecordId(db);
  const users = db.prepare('SELECT * FROM users').all().map(Auth.publicUser);
  const defectLib = db.prepare('SELECT * FROM defect_library ORDER BY id').all().map(d => ({
    name: d.name, category: d.category, defaultLevel: d.defaultLevel,
    keywords: (() => { try { return JSON.parse(d.keywords || '[]'); } catch (e) { return []; } })(),
    enabled: !!d.enabled, createdAt: d.createdAt,
  }));
  const partners = db.prepare('SELECT * FROM partners ORDER BY id').all()
    .map(p => ({ name: p.name, type: p.type, createdAt: p.createdAt }));
  return { records, nextId, users, defectLib, partners };
}

/* 录入流程只增加未知名称，不把浏览器的全量旧快照当作库管理修改。
   现有条目的全部属性和其它标签页刚新增的条目原样保留。 */
function appendDefects(db, lib) {
  db.exec('BEGIN');
  try {
    const names = new Set(db.prepare('SELECT name FROM defect_library').all().map(row => String(row.name ?? '').trim()));
    const pending = new Set();
    const additions = [];
    for (const item of lib) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.name !== 'string' || !item.name.trim()) {
        Auth.fail(400, '不良描述名称格式不正确');
      }
      const name = item.name.trim();
      if (names.has(name)) continue;
      if (pending.has(name)) Auth.fail(400, '不良描述名称重复');
      pending.add(name);
      if (['category', 'defaultLevel', 'createdAt'].some(key => item[key] != null && typeof item[key] !== 'string') ||
          item.keywords != null && (!Array.isArray(item.keywords) || item.keywords.some(word => typeof word !== 'string')) ||
          item.enabled != null && ![true, false, 0, 1].includes(item.enabled)) {
        Auth.fail(400, '不良描述属性格式不正确');
      }
      additions.push({ ...item, name });
    }
    const insert = db.prepare('INSERT INTO defect_library(name,category,defaultLevel,keywords,enabled,createdAt) VALUES(?,?,?,?,?,?)');
    for (const item of additions) insert.run(item.name, item.category ?? null, item.defaultLevel ?? null,
      JSON.stringify(item.keywords || []), item.enabled ? 1 : 0, item.createdAt ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* Authorize the effective write, not the unchanged full browser snapshot. All
   checks finish before the existing atomic merge/replace transaction begins. */
const REVIEW_FIELDS = ['status', 'reviewBy', 'reviewAt', 'rejectReason', 'rejectBy', 'rejectAt'];
const NUMBER_FIELDS = new Set(['id', 'qty', 'sampleQty', 'pass', 'fail', 'orderQty']);
function statusOf(record) { return record.status || 'approved'; } // legacy records
function canonicalValues(record) {
  return recordValues(record).map((value, i) => {
    if (value === null) return null;
    if (NUMBER_FIELDS.has(RECORD_COLS[i])) {
      if (!Number.isFinite(value)) Auth.fail(400, '记录包含无效数值');
      return value;
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) Auth.fail(400, '记录字段格式不正确');
    return String(value);
  });
}
function validIds(ids) {
  if (!Array.isArray(ids)) Auth.fail(400, '记录编号须为数组');
  return ids.map(value => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) Auth.fail(400, '记录编号无效');
    return id;
  });
}
function authorizeRecordBatch(db, input, ids, user, replace = false) {
  if (!Array.isArray(input)) Auth.fail(400, 'records须为数组');
  const deleted = validIds(ids), seen = new Set();
  if (replace) Auth.requirePermission(user, 'import', 'm');
  if (deleted.length) Auth.requirePermission(user, 'records', 'm');
  const get = db.prepare('SELECT * FROM records WHERE id=?');
  const tomb = db.prepare('SELECT id FROM record_tombstones WHERE id=?');
  for (const id of deleted) {
    const current = get.get(id);
    if (current && statusOf(current) === 'approved') Auth.requirePermission(user, 'review', 'a');
  }
  if (replace && db.prepare("SELECT id FROM records WHERE status IS NULL OR status='' OR status='approved' LIMIT 1").get()) {
    Auth.requirePermission(user, 'review', 'a');
  }
  const output = input.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) Auth.fail(400, '记录格式不正确');
    const [id] = validIds([raw.id]);
    if (seen.has(id)) Auth.fail(400, '记录编号重复');
    seen.add(id);
    const currentRow = get.get(id), current = currentRow && rowToRecord(currentRow);
    // These rows cannot be written by upsertRecords. Preserve the stale and
    // tombstone rules without requiring edit rights on somebody else's row.
    if (!replace && (deleted.includes(id) || tomb.get(id) || current?.updatedAt &&
        (!raw.updatedAt || !Number.isFinite(Date.parse(raw.updatedAt)) || Date.parse(current.updatedAt) >= Date.parse(raw.updatedAt)))) return raw;
    const record = { ...raw, id };
    const values = canonicalValues(record);
    const before = current && canonicalValues(current);
    const businessChanged = !current || RECORD_COLS.some((col, i) => !REVIEW_FIELDS.includes(col) && col !== 'updatedAt' && values[i] !== before[i]);
    const nextStatus = record.status || (current ? statusOf(current) : 'pending');
    if (!['pending', 'approved', 'rejected'].includes(nextStatus)) Auth.fail(400, '审核状态无效');
    const reviewChanged = current && REVIEW_FIELDS.some(col => String(record[col] || '') !== String(current[col] || ''));
    const resubmission = current && statusOf(current) === 'rejected' && nextStatus === 'pending' && businessChanged;
    if (!replace && !current) Auth.requirePermission(user, 'records', 'e');
    /* 未审核通过的记录放开编辑：任何可录入账号都能改（records.e）；已审核由下行 review.a 兜底 */
    if (!replace && current && businessChanged) {
      if (statusOf(current) === 'approved') Auth.requirePermission(user, 'review', 'a');
      else Auth.requirePermission(user, 'records', 'e');
    }
    if (current && businessChanged && statusOf(current) === 'approved') Auth.requirePermission(user, 'review', 'a');
    if ((!current && (nextStatus !== 'pending' || REVIEW_FIELDS.slice(1).some(col => record[col]))) ||
        current && reviewChanged && !resubmission) Auth.requirePermission(user, 'review', 'a');
    if (resubmission) Auth.requirePermission(user, 'records', 'e');   /* 退回后重新提交同样放开 */
    // Unchanged rows may carry an old client-side audit display. Business edits
    // retain the database's audit fields unless a real review is being made.
    if (current && !businessChanged && !reviewChanged && !replace) return null;
    if (current && !reviewChanged) return record;
    record.status = nextStatus;
    if (nextStatus === 'pending') {
      for (const col of REVIEW_FIELDS.slice(1)) record[col] = '';
    } else {
      const actor = user.name || user.username, stamp = new Date().toISOString();
      if (nextStatus === 'approved') {
        record.reviewBy = actor; record.reviewAt = stamp;
        record.rejectBy = ''; record.rejectAt = ''; record.rejectReason = '';
      } else {
        if (!String(record.rejectReason || '').trim()) Auth.fail(400, '请填写退回原因');
        record.rejectBy = actor; record.rejectAt = stamp; record.reviewBy = ''; record.reviewAt = '';
      }
    }
    return record;
  });
  return { records: output.filter(Boolean), deletedIds: deleted };
}
function validatedUsers(db, input) {
  if (!Array.isArray(input)) Auth.fail(400, 'users须为数组');
  const old = new Map(db.prepare('SELECT * FROM users').all().map(user => [user.username, user]));
  const seen = new Set();
  const users = input.map(raw => {
    if (!raw || typeof raw.username !== 'string' || !raw.username.trim() || raw.username.length > 100 || raw.username.includes('\0')) Auth.fail(400, '账号格式不正确');
    const username = raw.username.trim();
    if (seen.has(username) || !['admin', 'manager', 'viewer'].includes(raw.role)) Auth.fail(400, '账号或角色无效');
    if (Object.hasOwn(raw, 'password')) Auth.fail(400, '修改密码请使用新密码字段');
    seen.add(username); const prior = old.get(username);
    let password = prior?.password || null;
    if (Object.hasOwn(raw, 'newPassword')) password = Auth.hashPassword(raw.newPassword);
    if (!prior && !password) Auth.fail(400, '新增账号须设置密码');
    let perms = null;
    if (raw.perms != null) {
      if (typeof raw.perms !== 'object' || Array.isArray(raw.perms)) Auth.fail(400, '权限格式不正确');
      perms = {};
      for (const menu of Object.keys(raw.perms)) {
        if (!Auth.MENUS.includes(menu) || !raw.perms[menu] || typeof raw.perms[menu] !== 'object' || Array.isArray(raw.perms[menu])) Auth.fail(400, '权限菜单无效');
        perms[menu] = {};
        for (const [col, value] of Object.entries(raw.perms[menu])) {
          if (!Auth.COLUMNS.includes(col) || ![0, 1, false, true].includes(value)) Auth.fail(400, '权限值无效');
          perms[menu][col] = value === 1 || value === true ? 1 : 0;
        }
      }
    }
    const enabled = raw.enabled === true || raw.enabled === 1;
    if (username === 'jc' && (!enabled || raw.role !== 'admin')) Auth.fail(400, '主账号不能停用或降权');
    return { username, password, role: raw.role, enabled, name: String(raw.name || '').slice(0, 200),
      dept: String(raw.dept || '').slice(0, 200), perms,
      createdAt: prior?.createdAt || new Date().toISOString(), lastLoginAt: prior?.lastLoginAt || null };
  });
  if (old.has('jc') && !seen.has('jc')) Auth.fail(400, '主账号不能删除');
  if (!users.some(user => user.role === 'admin' && user.enabled)) Auth.fail(400, '须保留至少一个启用的主账号');
  return users;
}
function sessionResponse(session, companyId) {
  return { ok: true, user: Auth.publicUser(session.user), companies: [companyId], csrfToken: session.csrfToken };
}

/* ════════ HTTP 工具 ════════ */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function sendDownload(req, res, contentType, filename, body) {
  const safeName = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, '_') || 'download';
  const encoded = encodeURIComponent(safeName);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 50 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatModifiedDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function neutralizeSpreadsheetFormula(v) {
  const value = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function csvCell(v) {
  return '"' + neutralizeSpreadsheetFormula(v).replace(/"/g, '""') + '"';
}

function htmlCell(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPassRecord(r) {
  return String(r.result || '').toUpperCase() === 'PASS';
}

function isFailRecord(r) {
  const v = String(r.result || '').toUpperCase();
  return v === 'REJ' || v === 'FAIL';
}

function getFilteredExportRecords(db, searchParams) {
  const search = String(searchParams.get('search') || '').trim().toLowerCase();
  const result = String(searchParams.get('result') || '').trim().toUpperCase();
  const from = String(searchParams.get('dateFrom') || '').trim();
  const to = String(searchParams.get('dateTo') || '').trim();
  return getBootstrap(db).records.filter(r => {
    if (search) {
      const haystack = [
        r.supplier, r.productNo, r.productName, r.client, r.processType, r.orderNo, r.deliveryNo,
        r.defect, r.updatedAt, formatModifiedDate(r.updatedAt),
      ]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (result === 'PASS' && !isPassRecord(r)) return false;
    if (result === 'REJ' && !isFailRecord(r)) return false;
    if (from && String(r.date || '') < from) return false;
    if (to && String(r.date || '') > to) return false;
    return true;
  });
}

function buildRecordsCsv(records) {
  const hdr = ['ID','来料日期','检验日期','修改日期','供应商','客户','加工类型','送货单号','货号','款式名称','PO号','类型',
    '来料数量','抽查数量','PASS数','FAIL数','不良率','不良现象','判定结果','检验员','备注'];
  const rows = records
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map(r => [
      r.id, r.date, r.inspDate, formatModifiedDate(r.updatedAt), r.supplier, r.client, r.processType, r.deliveryNo, r.productNo, r.productName,
      r.orderNo, r.type, r.qty, r.sampleQty, r.pass, r.fail, r.defectRate, r.defect, r.result, r.qc, r.remark,
    ].map(csvCell));
  return '﻿' + [hdr.map(csvCell), ...rows].map(r => r.join(',')).join('\n'); // 前导 ﻿ = BOM，Excel 正确识别 UTF-8
}

function buildFactoryExcelHtml(records) {
  const headers = ['序号','来货日期','供应商','加工类型','客户','送货单号','PO号','货号','产品名称','数量','单数','检验结果','不良描述','检验人','备注'];
  const rows = records.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 10pt; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: center; mso-number-format:"\\@"; }
  .title { font-size: 14pt; font-weight: 700; text-align: center; height: 26px; }
  .head { background: #d9e1f2; font-weight: 700; }
  .left { text-align: left; }
</style>
</head>
<body>
<table>
  <tr><td class="title" colspan="15">加工厂品质检验明细统计表</td></tr>
  <tr>${headers.map(h => `<th class="head">${htmlCell(h)}</th>`).join('')}</tr>
  ${rows.map((r, i) => `<tr>
    <td>${i + 1}</td>
    <td>${htmlCell(r.date || '')}</td>
    <td>${htmlCell(r.supplier || '')}</td>
    <td>${htmlCell(r.processType || r.type || '')}</td>
    <td>${htmlCell(r.client || '')}</td>
    <td>${htmlCell(r.deliveryNo || '')}</td>
    <td>${htmlCell(r.orderNo || '')}</td>
    <td>${htmlCell(r.productNo || '')}</td>
    <td class="left">${htmlCell(r.productName || '')}</td>
    <td>${htmlCell(r.qty != null && r.qty !== '' ? r.qty : '')}</td>
    <td></td>
    <td>${htmlCell(r.result || '')}</td>
    <td class="left">${htmlCell(r.defect || '')}</td>
    <td>${htmlCell(r.qc || '')}</td>
    <td>${htmlCell(r.remark || '')}</td>
  </tr>`).join('')}
</table>
</body>
</html>`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { res.writeHead(400); return res.end('bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const norm = rel.replace(/\\/g, '/').toLowerCase();
  // 安全：禁止访问后端目录、数据目录(qc.db)、上级目录
  if (norm.includes('..') || norm.startsWith('/server/') || norm.startsWith('/data/')) {
    res.writeHead(403); return res.end('forbidden');
  }
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // 前端代码类资源禁用缓存，避免手机/浏览器缓存旧版（适配、逻辑改了不生效）
    if (['.html', '.js', '.css', '.json', '.wasm', '.gz'].includes(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

/* ════════ 路由 ════════ */
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (_) { return sendJson(res, 400, { ok: false, error: '请求地址无效' }); }
  const p = url.pathname;

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  try {
    if (p === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }
    /* ── 厂区清单（登录页用，无需鉴权）── */
    if (p === '/api/companies' && req.method === 'GET') {
      return sendJson(res, 200, { companies: COMPANIES });
    }

    // The old quality portal signs tickets in public browser JavaScript. Those
    // tickets cannot establish a server identity, regardless of their signature.
    if (p === '/api/sso-verify' && req.method === 'POST') {
      return sendJson(res, 401, { ok: false, error: '请使用品质系统账号登录' });
    }
    const companyId = resolveCompany(url.searchParams);
    if (companyId === null) return sendJson(res, 400, { ok: false, error: '未知厂区' });
    if (p === '/api/login' && req.method === 'POST') {
      Auth.validJSONRequest(req);
      const body = await readBody(req);
      if (!body || typeof body.username !== 'string' || !body.username.trim() || body.username.length > 100 ||
          typeof body.password !== 'string' || !body.password || body.password.length > 1024) Auth.fail(400, '请输入用户名和密码');
      const username = body.username.trim();
      const succeeded = sessions.loginAttempt(req, companyId, username);
      const db = _dbs.get(companyId);
      const user = db && db.prepare('SELECT * FROM users WHERE username=?').get(username);
      if (!user || user.enabled !== 1 || !Auth.checkPassword(body.password, user.password)) Auth.fail(401, '用户名或密码错误，或账号已停用');
      // Upgrade the legacy browser checksum only after verifying the existing
      // password. Existing passwords and roles continue to work unchanged.
      if (!user.password.startsWith('scrypt$')) user.password = Auth.hashPassword(body.password, 1);
      user.lastLoginAt = new Date().toISOString();
      db.prepare('UPDATE users SET lastLoginAt=?,password=? WHERE username=?').run(user.lastLoginAt, user.password, username);
      const csrfToken = sessions.login(req, res, companyId, user); succeeded();
      return sendJson(res, 200, sessionResponse({ user, csrfToken }, companyId));
    }
    if (p === '/api/integration/inspections' && req.method === 'GET') {
      const expected = process.env.QC_INSPECTIONS_READ_TOKEN;
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(expected || '') || !Auth.equalSecret(req.headers.authorization, 'Bearer ' + expected)) Auth.fail(401, '读取凭据无效');
      const db = _dbs.get(companyId);
      if (!db) Auth.fail(503, '品质系统尚未就绪');
      const fields = ['id', 'date', 'inspDate', 'supplier', 'client', 'productNo', 'productName',
        'deliveryNo', 'orderNo', 'type', 'qty', 'sampleQty', 'fail', 'defectRate', 'result', 'defect', 'qc', 'remark'];
      const records = db.prepare('SELECT * FROM records ORDER BY id').all().map(row => Object.fromEntries(fields.map(key => [key, row[key]])));
      return sendJson(res, 200, { company: companyId, records });
    }
    // Reject before calling getDb(): unauthenticated callers cannot initialize,
    // migrate, seed or select another company's database.
    const session = sessions.authenticate(req, companyId, username => _dbs.get(companyId)?.prepare('SELECT * FROM users WHERE username=?').get(username));
    if (!['GET', 'HEAD'].includes(req.method)) sessions.requireCSRF(req, session);
    if (p === '/api/session' && req.method === 'GET') return sendJson(res, 200, sessionResponse(session, companyId));
    if (p === '/api/logout' && req.method === 'POST') {
      sessions.clear(req, res, companyId); return sendJson(res, 200, { ok: true });
    }
    const db = _dbs.get(companyId), user = session.user;
    if (!db) Auth.fail(503, '品质系统尚未就绪');

    if (p === '/api/bootstrap' && req.method === 'GET') {
      const data = getBootstrap(db);
      const readRecords = ['dashboard', 'records', 'review', 'analysis', 'daily', 'weekly', 'monthly', 'yearly', 'supplier-report'].some(menu => Auth.can(user, menu, 'v'));
      if (!readRecords) { data.records = []; data.nextId = 31; }
      if (!Auth.can(user, 'users', 'v')) data.users = [Auth.publicUser(user)];
      if (!Auth.can(user, 'suppliers', 'v')) data.partners = [];
      if (!Auth.can(user, 'defectlib', 'v') && !Auth.can(user, 'records', 'v')) data.defectLib = [];
      return sendJson(res, 200, { company: companyId, ...data, ...sessionResponse(session, companyId) });
    }
    if (p === '/api/export/records.csv' && (req.method === 'GET' || req.method === 'HEAD')) {
      Auth.requirePermission(user, 'records', 'v');
      const records = getFilteredExportRecords(db, url.searchParams);
      const body = buildRecordsCsv(records);
      return sendDownload(req, res, 'text/csv; charset=utf-8', `${companyName(companyId)}验货明细_${todayStr()}.csv`, body);
    }
    if (p === '/api/export/factory-excel.xls' && (req.method === 'GET' || req.method === 'HEAD')) {
      Auth.requirePermission(user, 'records', 'v');
      const records = getFilteredExportRecords(db, url.searchParams);
      const from = String(url.searchParams.get('dateFrom') || '').trim();
      const to = String(url.searchParams.get('dateTo') || '').trim();
      const span = (from || to) ? `_${from || '起始'}至${to || '今'}` : '_全部';
      const body = '﻿' + buildFactoryExcelHtml(records);
      return sendDownload(req, res, 'application/vnd.ms-excel; charset=utf-8', `${companyName(companyId)}品质检验明细统计表${span}.xls`, body);
    }
    if (p === '/api/records' && req.method === 'POST') {
      const body = await readBody(req);
      const allowed = authorizeRecordBatch(db, body.records, body.deletedIds || [], user);
      const r = mergeRecordChanges(db, allowed.records, allowed.deletedIds);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM records').get().c,
        ...r });
    }
    if (p === '/api/records/delete' && req.method === 'POST') {
      const body = await readBody(req);
      const allowed = authorizeRecordBatch(db, [], body.ids, user);
      const n = deleteRecords(db, allowed.deletedIds);
      return sendJson(res, 200, { ok: true, deleted: n });
    }
    if (p === '/api/records/replace' && req.method === 'POST') {
      const body = await readBody(req);
      const allowed = authorizeRecordBatch(db, body.records, [], user, true);
      replaceRecords(db, allowed.records);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM records').get().c });
    }
    if (p === '/api/users' && req.method === 'POST') {
      const body = await readBody(req);
      Auth.requirePermission(user, 'users', 'm');
      const previous = db.prepare('SELECT username,password,enabled FROM users').all();
      const users = validatedUsers(db, body.users);
      replaceUsers(db, users);
      for (const old of previous) {
        const next = users.find(item => item.username === old.username);
        if (!next || !next.enabled || next.password !== old.password) sessions.revoke(companyId, old.username);
      }
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM users').get().c });
    }
    if (p === '/api/partners' && req.method === 'POST') {
      const body = await readBody(req);
      Auth.requirePermission(user, 'suppliers', 'e');
      if (!Array.isArray(body.partners)) Auth.fail(400, 'partners须为数组');
      replacePartners(db, body.partners);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM partners').get().c });
    }
    if (p === '/api/defects' && req.method === 'POST') {
      const body = await readBody(req);
      const managesLibrary = Auth.can(user, 'defectlib', 'm');
      if (!managesLibrary) Auth.requirePermission(user, 'records', 'e');
      if (!Array.isArray(body.defectLib)) Auth.fail(400, 'defectLib须为数组');
      if (managesLibrary) {
        // Keep the existing library-management and delete/rename permissions.
        const oldDefects = db.prepare('SELECT name,category FROM defect_library').all();
        if (oldDefects.some(old => !body.defectLib.some(item => item.name === old.name && item.category === old.category))) Auth.requirePermission(user, 'records', 'm');
        replaceDefects(db, body.defectLib);
      } else appendDefects(db, body.defectLib);
      return sendJson(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) c FROM defect_library').get().c });
    }
    /* ── AI（阿里百炼，全局共用，不分厂区）── */
    if (p === '/api/ai/status' && req.method === 'GET') {
      Auth.requirePermission(user, 'records', 'e');
      return sendJson(res, 200, { ready: AI.ready, ocrModel: AI.ocrModel, baseURL: AI.baseURL });
    }
    if (p === '/api/ai/reload' && req.method === 'POST') {
      Auth.requirePermission(user, 'users', 'm');
      AI = loadAiConfig();
      return sendJson(res, 200, { ok: true, ready: AI.ready, ocrModel: AI.ocrModel });
    }
    if (p === '/api/ai/ocr-extract' && req.method === 'POST') {
      const body = await readBody(req);
      Auth.requirePermission(user, 'records', 'e');
      if (!body || !body.image) return sendJson(res, 400, { ok: false, error: '缺少 image 字段（base64 dataURL）' });
      try {
        const r = await aiVisionExtract(body.image);
        return sendJson(res, 200, { ok: true, fields: r.fields, usage: r.usage, rawText: r.rawText });
      } catch (e) {
        const code = e.code === 'NO_AI' ? 503 : 502;
        return sendJson(res, code, { ok: false, error: String(e && e.message || e), code: e.code || 'ERR' });
      }
    }
    return sendJson(res, 404, { ok: false, error: 'unknown api route' });
  } catch (e) {
    const code = e instanceof Auth.AuthError ? e.status : e instanceof SyntaxError ? 400 : 500;
    if (code === 500) console.error('[api error]', p, e && e.name);
    return sendJson(res, code, { ok: false, error: e instanceof Auth.AuthError ? e.message : code === 400 ? 'JSON格式不正确' : '请求失败，请稍后重试' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('════════════════════════════════════════════');
  console.log('  兴信 QMS 后端已启动（多厂区模式）');
  console.log('  本机:   http://localhost:' + server.address().port + '/index.html');
  console.log('  数据目录: ' + DATA_DIR);
  for (const c of COMPANIES) {
    const b = getBootstrap(getDb(c.id));
    console.log('  厂区「' + c.name + '」: 记录 ' + b.records.length + ' 条 / 账号 ' + b.users.length + ' 个 / 不良库 ' + b.defectLib.length + ' 条');
  }
  console.log('  AI(百炼): ' + (AI.ready ? ('已就绪, 模型 ' + AI.ocrModel) : '未配置(填 ai-config.json 后调 /api/ai/reload)'));
  console.log('════════════════════════════════════════════');
});
