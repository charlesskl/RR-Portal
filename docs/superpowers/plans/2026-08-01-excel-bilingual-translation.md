# Excel 全工作表中英互译 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有走货明细管理应用中增加独立的 Excel 中英翻译工具，扫描 `.xlsx`/`.xlsm` 全部工作表，在原单元格追加中英文并生成通过结构校验的阅读型副本。

**Architecture:** 后端把上传扫描、单并发翻译队列、工作簿改写和 OOXML 完整性校验拆成独立模块；翻译文本去重后通过现有 `google-translate-api-x` 适配器批量处理，任务只保存在内存和临时目录。前端新增独立页面，采用“上传扫描 → 用户确认 → 轮询进度 → 下载”的两阶段流程，并沿用现有 JWT 拦截器。

**Tech Stack:** Node.js 18 CommonJS、Express 4、Multer、`xlsx-populate@1.21.0`、PizZip、`google-translate-api-x@10.7.2`、React 19、Vite 7、Ant Design 6、Node 内置 `node:test`。

## Global Constraints

- 相关设计：`docs/superpowers/specs/2026-08-01-excel-bilingual-translation-design.md`。
- 执行前必须使用 `superpowers:using-git-worktrees` 创建隔离工作树；仓库主工作树已有未跟踪文件，不得修改、删除或提交它们。
- 所有命令默认从隔离工作树根目录执行；服务端目录为 `apps/工程部/A-doc生成系統/server`，前端目录为 `apps/工程部/A-doc生成系統/client`。
- 本机 Node 路径：`/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。
- 本机 pnpm 路径：`/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm`；只用于安装被 `.gitignore` 忽略的 `node_modules`，安装时加 `--no-lockfile --ignore-workspace`，不得创建或提交新的 pnpm 锁文件。
- 不新增运行时依赖；使用现有 `xlsx-populate`、`pizzip`、`google-translate-api-x`。测试使用 Node 内置测试运行器。
- 输入仅支持一个 `.xlsx` 或 `.xlsm`；压缩文件上限 50 MB，解压后的 OOXML 部件总量上限 512 MB；拒绝 `.xls`、`.xlsb`、CSV、加密、损坏或非 ZIP Office 文件。
- `.xlsx` 输出后缀为 `_中英翻译.xlsx`；`.xlsm` 输出后缀为 `_中英翻译.xlsm`。不得原地覆盖输入文件。
- 同一单元格追加语言，分隔符固定为 ` / `；中文补英文、英文补中文、印尼文/其他语言保留原文并补中文和英文；再次处理不得重复追加。
- 工作表名称、顺序、可见性、公式表达式、样式、合并区域、行高列宽、图片、drawing、chart、external link、嵌入对象和 VBA 部件不得被翻译逻辑修改。
- 不翻译工作表名、公式、批注、文本框、图表标题、图片内文字或 VBA 代码；不增删行列。
- 输出定位为阅读型副本：公式表达式保留，但依赖已翻译文字值的公式重算结果允许变化；页面必须在有公式时提示。
- 翻译服务只接收去重后的文字，不接收完整工作簿、公式、图片或格式；日志和 API 错误摘要不得包含完整单元格原文或译文。
- 所有 `/api/excel-translations` 接口要求现有 JWT 登录并按 `req.user.id` 校验任务所有权；错误任务 ID和他人任务统一返回 404，避免泄露存在性。
- 任务不写入产品或其他 JSON 数据库。`ready` 状态 1 小时未启动则清理；运行状态不清理；终态重新计算 1 小时保留期；查询和下载不续期。
- 扫描和翻译操作单并发。页面每 10 秒轮询一次，在 `ready` 或终态停止轮询。
- `.xlsm` 支持是首版交付要求，但宏保真闸门未通过时不得开放或静默降级；必须保留宏 Content-Type、关系和 VBA 二进制哈希。

## File Map

- `server/utils/translationRules.js`：候选判断、语言补齐计划、幂等拼接。
- `server/utils/translationProvider.js`：Google 翻译批次、超时、两次重试和单条降级。
- `server/utils/excelTranslator.js`：全工作表扫描、去重、普通/富文本写回和进度回调。
- `server/utils/workbookIntegrity.js`：ZIP 限制、结构快照、受保护部件哈希和输入输出校验。
- `server/utils/translationJobManager.js`：内存任务、单并发队列、所有权、TTL 和下载元数据。
- `server/routes/excelTranslation.js`：上传、开始、状态和下载 API。
- `client/src/pages/excelTranslateState.js`：前端状态派生函数。
- `client/src/pages/ExcelTranslatePage.jsx`：翻译页面和轮询交互。
- `client/src/App.jsx`：独立菜单、标题和页面挂载。
- `client/vite.config.js`：局域网监听和正确的本地 API 代理。
- `server/test/*.test.js`、`client/src/pages/*.test.js`：自动化测试。

## Execution Bootstrap

隔离工作树建立后、Task 1 之前执行一次依赖安装。它只生成被忽略的 `node_modules`，不读取或写入 pnpm lock：

```bash
cd 'apps/工程部/A-doc生成系統/server'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  install --ignore-workspace --no-lockfile
cd '../client'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  install --ignore-workspace --no-lockfile
cd ../../../..
git status --short
```

Expected: 两个安装成功；`git status --short` 不出现 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 或 `node_modules`。

## Requirements Traceability

| 设计要求 | 实施任务 |
|---|---|
| 独立菜单、现有登录、本机/局域网使用 | Task 6、7 |
| 上传扫描后确认、全部可见/隐藏/非常隐藏 Sheet | Task 3、5、6、7 |
| 中英/印尼文补齐、语言检测、去重、幂等 | Task 1、2 |
| 跳过公式/代码/路径，保留富文本与单元格样式 | Task 1、3 |
| 阅读型副本公式提示 | Task 3、7 |
| 图片/关系/样式完整性、`.xlsm` 宏保真闸门 | Task 4、8 |
| 单并发、1 小时 TTL、部分/完全失败语义 | Task 2、5 |
| 任务所有权、安全下载、不写业务数据库、日志隐私 | Task 5、6 |
| 用户 29-Sheet 工作簿与真实 VBA 验收 | Task 8 |

---

### Task 1: 翻译规则与幂等拼接

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/utils/translationRules.js`
- Create: `apps/工程部/A-doc生成系統/server/test/translationRules.test.js`
- Modify: `apps/工程部/A-doc生成系統/server/package.json:5-9`

**Interfaces:**
- Consumes: `provider.translateMany(requests)`，其中每个请求为 `{ id, text, from, to }`。
- Produces: `isCandidateText(text) -> boolean`、`analyzeText(text) -> Analysis`、`translateUniqueTexts(texts, provider) -> Promise<Map<string, TranslationOutcome>>`。
- `TranslationOutcome` 固定为 `{ status: 'translated'|'skipped'|'failed', value, reason }`；失败时 `value` 必须等于原文。

- [ ] **Step 1: 增加 Node 测试脚本并写失败测试**

在 `server/package.json` 添加：

```json
"test": "node --test test/*.test.js"
```

测试至少包含以下表格驱动用例和一个批量假提供方：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCandidateText,
  analyzeText,
  translateUniqueTexts,
} = require('../utils/translationRules');

test('skips formulas-by-caller, codes, paths, errors and non-text tokens', () => {
  for (const value of [
    '47193C', 'https://example.com', 'a@b.com', '123.45', '---',
    '#N/A', 'C:\\orders\\sample.xlsx', 'folder/sample.xlsx',
  ]) {
    assert.equal(isCandidateText(value), false, value);
  }
});

test('keeps canonical bilingual and trilingual text idempotent', async () => {
  const provider = fakeProvider({
    'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
  });
  const input = ['卡车车身 / Truck body', 'Nama Produk / 产品名称 / Product Name'];
  const result = await translateUniqueTexts(input, provider);
  assert.equal(result.get(input[0]).value, input[0]);
  assert.equal(result.get(input[0]).status, 'skipped');
  assert.equal(result.get(input[1]).value, input[1]);
});

test('adds English to Chinese, Chinese to English, and both to Indonesian', async () => {
  const provider = fakeProvider({
    '卡车车身|en': { text: 'Truck body', detectedLanguage: 'zh-CN' },
    'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
    '製品名|en': { text: 'Product Name', detectedLanguage: 'ja' },
    '製品名|zh-CN': { text: '产品名称', detectedLanguage: 'ja' },
  });
  const result = await translateUniqueTexts(
    ['卡车车身', 'Truck body', 'Nama Produk', '製品名'],
    provider,
  );
  assert.equal(result.get('卡车车身').value, '卡车车身 / Truck body');
  assert.equal(result.get('Truck body').value, 'Truck body / 卡车车身');
  assert.equal(result.get('Nama Produk').value, 'Nama Produk / 产品名称 / Product Name');
  assert.equal(result.get('製品名').value, '製品名 / 产品名称 / Product Name');
});
```

`fakeProvider` 必须记录请求 ID，不使用原文作为日志或 ID。

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run:

```bash
cd 'apps/工程部/A-doc生成系統/server'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/translationRules.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../utils/translationRules'`。

- [ ] **Step 3: 实现候选判断和语言计划**

核心规则使用下列常量和分支；只有带空格的标准分隔符才作为系统语言段拆分，避免把路径或日期中的 `/` 误识别：

```js
const SEP = ' / ';
const HAS_ZH = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const URL_OR_EMAIL = /^(?:https?:\/\/|www\.)|^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const FILE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|[^\s\\/]+[\\/])[^\r\n]*$/;
const EXCEL_ERROR = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA)$/i;
const PURE_CODE = /^(?=.*\d)[A-Z0-9._#-]{2,}$/i;
const PURE_NUMBER_OR_PUNCT = /^[\d\s.,:+\-/%()#_]+$/;

function isCandidateText(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim();
  return Boolean(value)
    && !URL_OR_EMAIL.test(value)
    && !FILE_PATH.test(value)
    && !EXCEL_ERROR.test(value)
    && !PURE_CODE.test(value)
    && !PURE_NUMBER_OR_PUNCT.test(value);
}

function analyzeText(text) {
  const original = String(text ?? '');
  const core = original.trim();
  if (!isCandidateText(core)) return { original, core, action: 'skip', reason: 'non-translatable' };
  const segments = core.split(SEP).map(s => s.trim()).filter(Boolean);
  const chineseSegments = segments.filter(s => HAS_ZH.test(s));
  const latinSegments = segments.filter(s => /[A-Za-z]/.test(s) && !HAS_ZH.test(s));
  if (segments.length >= 3 && chineseSegments.length && latinSegments.length) {
    return { original, core, action: 'complete', segments };
  }
  return { original, core, action: 'translate', segments, chineseSegments, latinSegments };
}
```

`translateUniqueTexts` 必须：去重输入；单段含汉字时用 `from: 'auto'` 请求英文并检查返回的检测语言，若检测为中文只补英文，若检测为日文等其他语言则再请求中文；无汉字单段先用 `from: 'auto'` 翻成中文并读取检测语言，检测为 `en` 时直接拼接中文结果，其他语言再把原文翻成英文；已有两段且包含中文时，对另一段做语言检测，英文则跳过，其他语言则只补英文；无法仅凭字符确定的多段结构必须使用提供方检测，不得凭“含拉丁字母”直接判定已完整。任何缺失结果保持原文并返回 `failed`；拼接时以未 trim 的 `original` 为前缀，保留原有前后空白，并在写入前检查 Excel 32,767 字符上限。

- [ ] **Step 4: 增加混合文本和部分语言测试**

增加一个独立测试，显式定义提供方返回值，避免依赖其他测试中的局部变量：

```js
test('handles embedded codes, mixed text, and one missing target language', async () => {
  const provider = fakeProvider({
    'Nama Produk|zh-CN': { text: '产品名称', detectedLanguage: 'id' },
    'Nama Produk|en': { text: 'Product Name', detectedLanguage: 'id' },
    'Truck body|zh-CN': { text: '卡车车身', detectedLanguage: 'en' },
  });
  const input = ['Nama Produk / 产品名称', '卡车车身 / Truck body'];
  const result = await translateUniqueTexts(input, provider);

  assert.equal(analyzeText('产品 47193C').action, 'translate');
  assert.equal(analyzeText('透明胶纸 transparent tape').action, 'translate');
  assert.equal(result.get(input[0]).value, 'Nama Produk / 产品名称 / Product Name');
  assert.equal(result.get(input[1]).status, 'skipped');
});
```

再加入超过 32,767 字符、提供方返回错误、重复输入只生成一组请求，以及 `'  卡车车身  '` 输出仍以完整未修剪原文开头的测试。

- [ ] **Step 5: 运行规则测试并确认通过**

Run: `/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/translationRules.test.js`

Expected: 全部 PASS，无外网请求。

- [ ] **Step 6: 提交规则模块**

```bash
git add 'apps/工程部/A-doc生成系統/server/package.json' \
  'apps/工程部/A-doc生成系統/server/utils/translationRules.js' \
  'apps/工程部/A-doc生成系統/server/test/translationRules.test.js'
git commit -m 'feat(zouhuo): add bilingual translation rules'
```

---

### Task 2: 批量翻译提供方、超时和重试

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/utils/translationProvider.js`
- Create: `apps/工程部/A-doc生成系統/server/test/translationProvider.test.js`

**Interfaces:**
- Consumes: `google-translate-api-x(text|string[], { from, to })`。
- Produces: `createTranslationProvider(options) -> { translateMany(requests) }`。
- `translateMany` 返回 `Map<requestId, { text, detectedLanguage, error? }>`，保持请求 ID，不把文本写进错误字符串。

- [ ] **Step 1: 写失败测试覆盖批次、重试和局部失败**

```js
test('groups equal language pairs into batches and preserves request ids', async () => {
  const calls = [];
  const provider = createTranslationProvider({
    translateFn: async (texts, opts) => {
      calls.push({ texts, opts });
      return texts.map(text => ({ text: `T:${text}`, from: { language: { iso: 'zh-CN' } } }));
    },
    batchSize: 2,
    sleep: async () => {},
  });
  const result = await provider.translateMany([
    { id: 'r1', text: '甲', from: 'zh-CN', to: 'en' },
    { id: 'r2', text: '乙', from: 'zh-CN', to: 'en' },
    { id: 'r3', text: '丙', from: 'zh-CN', to: 'en' },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(result.get('r1').text, 'T:甲');
});
```

另写测试：前两次抛错、第三次成功；批次三次失败后逐条降级，其中一条成功、一条失败；15 秒超时通过注入较小 `timeoutMs` 验证。

- [ ] **Step 2: 运行测试确认失败**

Run: `/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/translationProvider.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现提供方工厂**

```js
function createTranslationProvider({
  translateFn = require('google-translate-api-x'),
  batchSize = 25,
  timeoutMs = 15_000,
  retryCount = 2,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  logger = console,
} = {}) {
  return { translateMany };
}
```

实现要求：按 `from + to` 分组，再按 25 条切块；每个块最多 3 次尝试（首次 + 两次重试），退避 250ms、500ms；数组结果和单结果统一为数组；批次永久失败后逐条重试；最终失败只返回 `{ error: 'translation_failed' }`。日志只包含批次数、目标语言和错误类型，不包含 `request.text`。

- [ ] **Step 4: 运行 Task 1 与 Task 2 测试**

Run:

```bash
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/translationRules.test.js test/translationProvider.test.js
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交提供方适配器**

```bash
git add 'apps/工程部/A-doc生成系統/server/utils/translationProvider.js' \
  'apps/工程部/A-doc生成系統/server/test/translationProvider.test.js'
git commit -m 'feat(zouhuo): add resilient translation provider'
```

---

### Task 3: 全工作表扫描、普通文本和富文本写回

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/utils/excelTranslator.js`
- Create: `apps/工程部/A-doc生成系統/server/test/helpers/workbookFixture.js`
- Create: `apps/工程部/A-doc生成系統/server/test/excelTranslator.test.js`

**Interfaces:**
- Consumes: Task 1 `analyzeText`、`translateUniqueTexts`，Task 2 provider。
- Produces: `scanWorkbook(inputPath, { onSheet }) -> ScanSummary`、`translateWorkbook(inputPath, outputPath, { provider, onProgress, maxUncompressedBytes }) -> TranslationSummary`。
- `ScanSummary` 为 `{ sheetCount, formulaCount, candidateCellCount, candidateUniqueCount }`。
- `TranslationSummary` 额外包含 `{ totalUnique, processedUnique, succeededCells, skippedCells, failedCells, changedCells }`；三种结果数均按单元格统计，`changedCells` 是 `Set<'SheetName!A1'>`。

- [ ] **Step 1: 创建可重复生成的工作簿 fixture**

`test/helpers/workbookFixture.js` 使用 `xlsx-populate` 生成：

```js
const rich = new XlsxPopulate.RichText()
  .add('Nama ', { bold: true, fontColor: 'FF0000' })
  .add('Produk', { italic: true });

sheet.cell('A1').value('卡车车身').style('bold', true);
sheet.cell('A2').formula('LEN(A1)');
sheet.range('B1:C1').merged(true);
sheet.cell('B1').value('Nama Produk');
sheet.cell('D1').value(rich);
workbook.addSheet('Hidden').hidden(true).cell('A1').value('Truck body');
workbook.addSheet('VeryHidden').hidden('very').cell('A1').value('产品 47193C');
```

同时设置行高、列宽和一个日期数值，供后续完整性测试复用。

- [ ] **Step 2: 写扫描和写回失败测试**

```js
test('scans every visible and hidden sheet but skips formulas and non-text', async () => {
  const summary = await scanWorkbook(inputPath);
  assert.equal(summary.sheetCount, 3);
  assert.equal(summary.formulaCount, 1);
  assert.equal(summary.candidateCellCount, 5);
});

test('writes translations without flattening rich text or changing formulas', async () => {
  const summary = await translateWorkbook(inputPath, outputPath, { provider: fakeProvider });
  const output = await XlsxPopulate.fromFileAsync(outputPath);
  assert.equal(output.sheet('Visible').cell('A1').value(), '卡车车身 / Truck body');
  assert.equal(output.sheet('Visible').cell('A2').formula(), 'LEN(A1)');
  const rich = output.sheet('Visible').cell('D1').value();
  assert.ok(rich instanceof XlsxPopulate.RichText);
  assert.equal(rich.get(0).style('bold'), true);
  assert.match(rich.text(), /^Nama Produk \/ /);
  assert.ok(summary.changedCells.has('Visible!D1'));
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/excelTranslator.test.js`

Expected: FAIL，`excelTranslator` 模块不存在。

- [ ] **Step 4: 实现统一单元格遍历器**

实现私有 `collectWorkbookCells(workbook, { onSheet })`：遍历 `workbook.sheets()`；空 Sheet 的 `usedRange()` 为 `undefined` 时继续；对 range 使用 `range.forEach(cell => visitCell(sheet, cell))`；始终先调用 `cell.formula()`，公式存在时只累加公式数，不读取缓存值作为候选；普通字符串直接取值；`XlsxPopulate.RichText` 使用 `value.text()`；只有 `analyzeText(text).action === 'translate'` 才计入扫描候选，`skip`/`complete` 不计入；需要提供方区分的两段中英/印尼文结构保守计为候选，所以正式 `totalUnique` 可小于扫描数；地址键固定为 `${sheet.name()}!${cell.address()}`。

- [ ] **Step 5: 实现扫描、去重翻译和安全写回**

普通文本写回完整 `TranslationOutcome.value`。富文本不得替换原对象，必须只追加新后缀并复制最后一个非空 fragment 的支持样式：

```js
const RICH_STYLES = [
  'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript',
  'fontSize', 'fontFamily', 'fontGenericFamily', 'fontScheme', 'fontColor',
];
const suffix = outcome.value.slice(originalText.length);
const rich = cell.value();
let styleSource;
for (let index = rich.length - 1; index >= 0; index -= 1) {
  const fragment = rich.get(index);
  if (fragment.value().trim()) {
    styleSource = fragment;
    break;
  }
}
if (!styleSource) throw new Error('rich_text_has_no_nonempty_fragment');
rich.add(suffix, styleSource.style(RICH_STYLES));
```

捕获单格富文本追加错误，保持原文并计入 `failedCells`。按唯一文本成功结果映射回全部地址；同一文本只向 provider 请求一次。`onProgress` 只传计数、阶段和 Sheet 名，不传文本。

- [ ] **Step 6: 增加二次处理幂等和部分失败测试**

第一次输出作为第二次输入，断言所有已翻译单元格不再变化；让假提供方只失败一个唯一文本，断言其他单元格成功、失败单元格保持原值、最终 summary 同时含成功和失败计数。另构造“非空富文本片段 + 尾部空片段”单元格，断言追加译文继承前一个非空片段的 `bold`、`superscript`、`fontColor` 而不是空片段样式。

- [ ] **Step 7: 运行前三组服务端测试**

Run:

```bash
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/translationRules.test.js test/translationProvider.test.js test/excelTranslator.test.js
```

Expected: 全部 PASS。

- [ ] **Step 8: 提交工作簿翻译核心**

```bash
git add 'apps/工程部/A-doc生成系統/server/utils/excelTranslator.js' \
  'apps/工程部/A-doc生成系統/server/test/helpers/workbookFixture.js' \
  'apps/工程部/A-doc生成系統/server/test/excelTranslator.test.js'
git commit -m 'feat(zouhuo): translate every workbook sheet safely'
```

---

### Task 4: OOXML 完整性校验与 XLSM 闸门

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/utils/workbookIntegrity.js`
- Create: `apps/工程部/A-doc生成系統/server/test/workbookIntegrity.test.js`
- Modify: `apps/工程部/A-doc生成系統/server/utils/excelTranslator.js`
- Modify: `apps/工程部/A-doc生成系統/server/test/excelTranslator.test.js`

**Interfaces:**
- Consumes: 输入/输出文件路径和 Task 3 的 `changedCells`。
- Produces: `assertPackageLimits(filePath, { maxUncompressedBytes })`、`snapshotWorkbook(filePath)`、`validateWorkbookIntegrity({ inputPath, outputPath, changedCells, maxUncompressedBytes })`。
- 校验失败抛出 `WorkbookIntegrityError`，其对外 `code` 只能是稳定技术码，不包含工作簿文字。

- [ ] **Step 1: 写包限制和结构破坏失败测试**

测试用 PizZip 复制 fixture 后执行破坏：删除受保护部件、修改非目标单元格、改变公式/合并区域、改变某个 `cellXf` 的 number format。断言前三类和样式语义变化都被拒绝；另用等价属性顺序重写一份 `styles.xml`，断言规范化语义比较通过，不误报损坏。其中非目标单元格例子断言：

```js
await assert.rejects(
  () => validateWorkbookIntegrity({ inputPath, outputPath, changedCells }),
  error => error.name === 'WorkbookIntegrityError' && error.code === 'unexpected_cell_change',
);
```

包大小单测试复用正常 fixture，调用 `assertPackageLimits(inputPath, { maxUncompressedBytes: 1 })` 断言 `package_too_large`，不在测试中分配 512 MB 内存；另用一个纯文本文件断言 `invalid_ooxml_package`。

- [ ] **Step 2: 运行完整性测试确认失败**

Run: `/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/workbookIntegrity.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 ZIP 快照和受保护部件哈希**

受保护路径判定必须覆盖：

```js
const PROTECTED = [
  /^xl\/media\//,
  /^xl\/drawings\//,
  /^xl\/charts\//,
  /^xl\/externalLinks\//,
  /^xl\/pivotTables\//,
  /^xl\/pivotCache\//,
  /^xl\/embeddings\//,
  /^xl\/activeX\//,
  /^xl\/ctrlProps\//,
  /^xl\/(?:comments\d+\.xml|threadedComments\/)/,
  /^xl\/persons\/person\.xml$/,
  /^customXml\//,
  /^xl\/vbaProject.*\.bin$/,
  /_rels\/.*\.rels$/,
];
```

使用 `crypto.createHash('sha256')` 对解压后的二进制/未解析部件 Buffer 哈希。输入输出受保护路径集合和哈希必须完全相同；单独语义解析 `[Content_Types].xml`，断言 `.xlsm` 的 macro-enabled workbook 声明和 VBA Content-Type 声明未变且未丢失。`xl/styles.xml` 和 `xl/calcChain.xml` 不做字节哈希，避免把等价 XML 重序列化误判为损坏。

- [ ] **Step 4: 实现工作簿语义快照**

快照必须包含 Sheet 名/顺序/`hidden()` 值、定义名称、合并 ref 集合、行高列宽、公式文本/类型/ref、所有单元格样式引用和非公式显示值。解析 `xl/styles.xml` 的 `numFmts`、`fonts`、`fills`、`borders`、`cellStyleXfs`、`cellXfs`、`cellStyles`、`dxfs` 为规范化语义对象并比较：忽略 XML 属性顺序和无意义空白，但保留 `fonts`/`fills`/`borders`/`cellXfs` 等按索引引用的节点顺序，只对以稳定 ID 为键且顺序不影响语义的集合按 ID 归一化；公式文本、类型和 ref 的快照覆盖计算链重建后的语义保真，不要求 `calcChain.xml` 字节不变。同时对 worksheet XML 提取并比较数据验证、条件格式、超链接、自动筛选、分页/打印设置和 drawing 关系 ID 等稳定属性，不比较 ZIP 时间戳或压缩方式。校验时允许 `changedCells` 中的显示值变化；其余单元格值必须相同，所有样式引用和上述结构属性必须相同。

- [ ] **Step 5: 把校验接入翻译输出**

`translateWorkbook` 写临时输出后调用：

```js
await validateWorkbookIntegrity({
  inputPath, outputPath, changedCells, maxUncompressedBytes,
});
```

失败时删除输出并继续向上抛错；不得返回带成功状态的 summary。

- [ ] **Step 6: 增加仓库自带 `.xlsm` 往返测试**

使用 `server/templates/走货明细模表.xlsm`，翻译一个临时副本并断言：输出仍为宏启用 Content-Type、VML drawing 与关系哈希一致、Excel 结构校验通过。该模板没有真实 VBA，仅覆盖宏启用容器和 VML；真实 VBA 闸门留到 Task 8。

- [ ] **Step 7: 运行 Task 3 与 Task 4 测试**

Run:

```bash
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/excelTranslator.test.js test/workbookIntegrity.test.js
```

Expected: 全部 PASS，损坏输出均被拒绝。

- [ ] **Step 8: 提交完整性保护**

```bash
git add 'apps/工程部/A-doc生成系統/server/utils/workbookIntegrity.js' \
  'apps/工程部/A-doc生成系統/server/utils/excelTranslator.js' \
  'apps/工程部/A-doc生成系統/server/test/workbookIntegrity.test.js' \
  'apps/工程部/A-doc生成系統/server/test/excelTranslator.test.js'
git commit -m 'feat(zouhuo): validate translated workbook integrity'
```

---

### Task 5: 单并发任务管理、所有权和 TTL

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/utils/translationJobManager.js`
- Create: `apps/工程部/A-doc生成系統/server/test/translationJobManager.test.js`
- Modify: `apps/工程部/A-doc生成系統/server/.env.example`

**Interfaces:**
- Consumes: `scanWorkbook`、`translateWorkbook`、输入临时路径。
- Produces: `createTranslationJobManager(options)`，方法固定为 `createJob`、`startJob`、`getJob`、`getDownload`、`sweepExpired`、`close`。
- `options` 包含 `jobsRoot`、`incomingDir`、`clock`、`idFactory`、`scanWorkbook`、`translateWorkbook`、`ttlMs`、`cleanupIntervalMs`，全部有生产默认值且可在测试注入。
- 签名固定为 `createJob({ ownerId, incomingPath, originalName, extension }) -> Promise<JobView>`、`startJob(ownerId, jobId) -> JobView`、`getJob(ownerId, jobId) -> JobView`、`getDownload(ownerId, jobId) -> { path, fileName, contentType }`、`sweepExpired() -> Promise<number>`。
- 所有公开任务视图不得包含 `ownerId`、`inputPath`、`outputPath`、原文或译文。

- [ ] **Step 1: 写状态、队列和过期失败测试**

测试顶部实现 `createHarness()`：用 `fs.promises.mkdtemp()` 创建每测试独立目录和一个输入文件，注入可控的 `clock`、`idFactory`、`scanWorkbook` 和 `translateWorkbook`；`afterEach` 必须调用 `manager.close()` 并删除该测试临时目录。用下列无定时器竞态的等待函数：

```js
async function waitForStatus(manager, ownerId, jobId, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const view = manager.getJob(ownerId, jobId);
    if (view.status === expected) return view;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`job ${jobId} did not reach ${expected}`);
}

test('moves scanning to ready and exposes only safe summary fields', async () => {
  const harness = await createHarness();
  const created = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: harness.incomingPath,
    originalName: 'sample.xlsx', extension: '.xlsx',
  });
  assert.equal(created.status, 'scanning');

  const ready = await waitForStatus(harness.manager, 'owner-a', created.jobId, 'ready');
  assert.equal(ready.sheetCount, 3);
  for (const privateKey of ['ownerId', 'inputPath', 'outputPath']) {
    assert.equal(Object.hasOwn(ready, privateKey), false);
  }
});

test('returns not-found for another owner', async () => {
  const harness = await createHarness();
  const created = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: harness.incomingPath,
    originalName: 'sample.xlsx', extension: '.xlsx',
  });
  assert.throws(
    () => harness.manager.getJob('owner-b', created.jobId),
    error => error.name === 'JobNotFoundError',
  );
});
```

再使用两个 `{ promise, resolve }` gate 编写队列测试：创建两个任务后断言只启动第一个 scan，解除第一个 gate 后才启动第二个。TTL 测试把时钟前移 `3_600_001`，断言 `ready`、`completed`、`completed_with_warnings`、`failed` 被删除，而 gate 仍未解除的 `scanning`、`queued`、`translating`、`writing`、`validating` 仍可查询。下载测试分别对两种可下载终态断言文件名/MIME，并对其他状态断言 `JobConflictError`。另注入 `{ succeededCells: 0, failedCells: 0, skippedCells: 3 }` summary，断言终态为 `completed`、输出可下载，不是 `failed` 或 warning。

- [ ] **Step 2: 运行任务管理测试确认失败**

Run: `/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/translationJobManager.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现任务模型和安全视图**

内部任务包含路径和 owner；公开视图只返回：

```js
{
  jobId, status, phase, originalName, downloadName,
  sheetCount, formulaCount, candidateCellCount, candidateUniqueCount,
  totalUnique, processedUnique, succeededCells, skippedCells, failedCells,
  currentSheet, errorCode, errorMessage, createdAt, expiresAt,
}
```

任务 ID 使用 `crypto.randomUUID()`。`createJob` 把 Multer 临时文件移动到 `uploads/translation-jobs/<jobId>/input.<ext>`，状态设为 `scanning` 并放入同一个 operation queue；扫描完成为 `ready`。`startJob` 仅接受 `ready`，否则抛 `JobConflictError`。`translating` 阶段的 `currentSheet` 固定为 `null`，仅扫描和写回阶段提供实际 Sheet 名。`errorMessage` 只能由稳定 `errorCode` 映射为预设中文文案，不得带工作簿内容。

- [ ] **Step 4: 实现单并发队列和 TTL**

队列一次执行一个 scan 或 translate 操作。运行中的 `scanning`、`queued`、`translating`、`writing`、`validating` 没有清理 deadline；`ready` 和终态设置 `expiresAt = now + 3_600_000`。factory 启动时先限定在 `translation-jobs` 和 `translation-incoming` 目录内清理上一进程遗留的孤儿文件（内存任务已不可恢复），然后才接收新任务。每 600,000ms 调用 `sweepExpired`，timer 调用 `.unref()`；`close()` 清 timer，供测试和服务关闭使用。

- [ ] **Step 5: 实现失败清理和下载门槛**

翻译 summary 中 `succeededCells > 0 && failedCells > 0` 时为 `completed_with_warnings`；`failedCells > 0 && succeededCells === 0` 时为 `failed`。若 `succeededCells === 0 && failedCells === 0 && skippedCells > 0`，说明扫描时的保守候选经语言检测后已完整：状态为 `completed`，保留并校验未新增译文的输出副本，页面显示“没有新增翻译，文件已保持原样”且允许下载。完整性错误为 `failed`。失败时立即删除不可用输出，保留原输入和任务记录至终态 TTL 到期；过期时再删除明确的 job 目录，不使用宽泛 glob。下载只返回 `{ path, fileName, contentType }`，其他状态抛 `JobConflictError`。

- [ ] **Step 6: 更新环境变量示例**

```dotenv
TRANSLATION_JOB_TTL_MS=3600000
TRANSLATION_CLEANUP_INTERVAL_MS=600000
TRANSLATION_MAX_UNCOMPRESSED_MB=512
TRANSLATION_BATCH_SIZE=25
TRANSLATION_TIMEOUT_MS=15000
```

- [ ] **Step 7: 运行任务管理与核心测试**

Run:

```bash
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/translationRules.test.js test/translationProvider.test.js \
  test/excelTranslator.test.js test/workbookIntegrity.test.js \
  test/translationJobManager.test.js
```

Expected: 全部 PASS，进程不会因清理 timer 挂住。

- [ ] **Step 8: 提交任务管理器**

```bash
git add 'apps/工程部/A-doc生成系統/server/utils/translationJobManager.js' \
  'apps/工程部/A-doc生成系統/server/test/translationJobManager.test.js' \
  'apps/工程部/A-doc生成系統/server/.env.example'
git commit -m 'feat(zouhuo): add translation job queue'
```

---

### Task 6: 鉴权上传、开始、状态和下载 API

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/config/translation.js`
- Create: `apps/工程部/A-doc生成系統/server/routes/excelTranslation.js`
- Create: `apps/工程部/A-doc生成系統/server/test/translationConfig.test.js`
- Create: `apps/工程部/A-doc生成系統/server/test/excelTranslationRoute.test.js`
- Modify: `apps/工程部/A-doc生成系統/server/app.js:19-56`

**Interfaces:**
- Consumes: Task 5 job manager、现有 `authenticate` 和 `auditLog`。
- Produces: `POST /api/excel-translations`、`POST /api/excel-translations/:jobId/start`、`GET /api/excel-translations/:jobId`、`GET /api/excel-translations/:jobId/download`。
- 路由模块导出 `createExcelTranslationRouter({ jobManager, incomingDir, limits }) -> Router` 供生产和测试统一调用，不在模块加载时隐式创建第二个 manager。

- [ ] **Step 1: 写配置和路由失败测试**

`translationConfig.test.js` 先写失败测试：注入完整 env 后断言 MB 正确换算为字节，TTL/清理/批次/超时都映射到对应 option；注入空值、负数和非数字时断言回退 50 MB/512 MB/1 小时/10 分钟/25 条/15 秒。

在测试 Express app 中使用现有 `authenticate`，设置测试 `JWT_SECRET` 并生成 owner-a/owner-b token。用 Node 18 原生 `fetch`、`FormData`、`Blob` 验证：未登录 401；`.xls`/伪 ZIP 400；通过注入小的 `maxFileBytes`/`maxUncompressedBytes` 验证两种超限均为 400；合法文件 202 + `scanning`；owner-b 查询 owner-a 任务 404；非 ready 开始 409；完成前下载 409；完成后 Content-Disposition 和 MIME 正确。

```js
const form = new FormData();
form.append('file', new Blob([buffer], { type: XLSX_MIME }), 'sample.xlsx');
const response = await fetch(`${baseUrl}/api/excel-translations`, {
  method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` },
});
assert.equal(response.status, 202);
```

- [ ] **Step 2: 运行路由测试确认失败**

Run:

```bash
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/translationConfig.test.js test/excelTranslationRoute.test.js
```

Expected: FAIL，配置与路由模块不存在。

- [ ] **Step 3: 实现安全 Multer 上传**

使用 disk storage 写入注入的 `incomingDir`，basename 清理文件名；只接受 `.xlsx`/`.xlsm` 和允许 MIME；Multer 文件大小使用注入的 `limits.maxFileBytes`。Multer 成功后立即使用 `limits.maxUncompressedBytes` 调用 `assertPackageLimits`，失败时删除本次 incoming 文件。`jobManager.createJob` 接管后移动到独立 job 目录。

- [ ] **Step 4: 实现四个接口和错误映射**

```js
router.post('/', upload.single('file'), createJobHandler);
router.post('/:jobId/start', startJobHandler);
router.get('/:jobId', getJobHandler);
router.get('/:jobId/download', downloadHandler);
```

`JobNotFoundError` → 404，`JobConflictError` → 409，上传验证 → 400，其他错误 → 500。响应错误只返回中文用户提示和技术 code。下载使用 job manager 提供的绝对路径、正确 Content-Type 和 RFC 5987 UTF-8 文件名。

- [ ] **Step 5: 实现生产配置映射并在 app.js 唯一装配**

`config/translation.js` 导出 `readTranslationConfig(env, { uploadsRoot })`，对非正整数回退默认值，并固定以下映射：`MAX_FILE_SIZE_MB -> maxFileBytes`、`TRANSLATION_MAX_UNCOMPRESSED_MB -> maxUncompressedBytes`、`TRANSLATION_JOB_TTL_MS -> jobTtlMs`、`TRANSLATION_CLEANUP_INTERVAL_MS -> cleanupIntervalMs`、`TRANSLATION_BATCH_SIZE -> batchSize`、`TRANSLATION_TIMEOUT_MS -> timeoutMs`。测试每个映射和无效/空值回退，同时断言 `jobsRoot`/`incomingDir` 均在注入的 `uploadsRoot` 内。

在宽泛 `/api` 走货路由之前使用该配置创建唯一 provider、manager 和 router：

```js
const { readTranslationConfig } = require('./config/translation');
const { createTranslationProvider } = require('./utils/translationProvider');
const { scanWorkbook, translateWorkbook } = require('./utils/excelTranslator');
const { createTranslationJobManager } = require('./utils/translationJobManager');
const { createExcelTranslationRouter } = require('./routes/excelTranslation');

const uploadsRoot = process.pkg
  ? path.join(path.dirname(process.execPath), 'uploads')
  : path.join(__dirname, 'uploads');
const translationConfig = readTranslationConfig(process.env, { uploadsRoot });
const translationProvider = createTranslationProvider({
  batchSize: translationConfig.batchSize,
  timeoutMs: translationConfig.timeoutMs,
});
const translationJobManager = createTranslationJobManager({
  jobsRoot: translationConfig.jobsRoot,
  incomingDir: translationConfig.incomingDir,
  ttlMs: translationConfig.jobTtlMs,
  cleanupIntervalMs: translationConfig.cleanupIntervalMs,
  scanWorkbook,
  translateWorkbook: (inputPath, outputPath, options) => translateWorkbook(
    inputPath,
    outputPath,
    {
      ...options,
      provider: translationProvider,
      maxUncompressedBytes: translationConfig.maxUncompressedBytes,
    },
  ),
});
app.use(
  '/api/excel-translations',
  authenticate,
  createExcelTranslationRouter({
    jobManager: translationJobManager,
    incomingDir: translationConfig.incomingDir,
    limits: {
      maxFileBytes: translationConfig.maxFileBytes,
      maxUncompressedBytes: translationConfig.maxUncompressedBytes,
    },
  }),
);
```

保留现有认证、走货、核价和 A-DOC 路由行为。在 `SIGINT`/`SIGTERM` 关闭路径调用 `translationJobManager.close()`，避免清理 timer 泄漏。

- [ ] **Step 6: 加入审计但不写业务数据库**

记录 `excel_translation_upload`、`excel_translation_start`、`excel_translation_download`，details 仅含 jobId、文件名、计数和状态，不含单元格内容。确认 `config/db.js` 没有新增 collection。

- [ ] **Step 7: 运行全部服务端测试**

Run:

```bash
cd 'apps/工程部/A-doc生成系統/server'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/*.test.js
```

Expected: 全部 PASS。

- [ ] **Step 8: 提交 API**

```bash
git add 'apps/工程部/A-doc生成系統/server/routes/excelTranslation.js' \
  'apps/工程部/A-doc生成系統/server/config/translation.js' \
  'apps/工程部/A-doc生成系統/server/test/translationConfig.test.js' \
  'apps/工程部/A-doc生成系統/server/test/excelTranslationRoute.test.js' \
  'apps/工程部/A-doc生成系統/server/app.js'
git commit -m 'feat(zouhuo): expose Excel translation jobs API'
```

---

### Task 7: 独立前端页面、轮询和局域网入口

**Files:**
- Create: `apps/工程部/A-doc生成系統/client/src/pages/excelTranslateState.js`
- Create: `apps/工程部/A-doc生成系統/client/src/pages/excelTranslateState.test.js`
- Create: `apps/工程部/A-doc生成系統/client/src/pages/ExcelTranslatePage.jsx`
- Modify: `apps/工程部/A-doc生成系統/client/src/App.jsx:1-116`
- Modify: `apps/工程部/A-doc生成系統/client/package.json:6-10`
- Modify: `apps/工程部/A-doc生成系統/client/vite.config.js:22-33`

**Interfaces:**
- Consumes: Task 6 API 和现有全局 axios JWT 拦截器。
- Produces: 菜单 key `excel-translate`、localStorage key `excelTranslationJobId`、页面状态派生函数 `shouldPoll`、`canStart`、`canDownload`、`progressPercent`、`statusLabel`、`completionNotice`。

- [ ] **Step 1: 写前端状态失败测试**

在 `client/package.json` 添加：

```json
"test": "node --test src/pages/*.test.js"
```

测试：`scanning`/`queued`/`translating` 需要轮询；`ready`/终态停止；只有 ready 且候选数大于 0 可开始；只有 completed 两种状态可下载；翻译阶段百分比使用唯一文本，写回阶段不倒退；`completed + succeededCells=0 + failedCells=0 + skippedCells>0` 的 `completionNotice` 为“没有新增翻译，文件已保持原样”。

```js
assert.equal(shouldPoll({ status: 'translating' }), true);
assert.equal(canStart({ status: 'ready', candidateUniqueCount: 0 }), false);
assert.equal(canDownload({ status: 'completed_with_warnings' }), true);
```

- [ ] **Step 2: 运行状态测试确认失败**

Run:

```bash
cd 'apps/工程部/A-doc生成系統/client'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  src/pages/excelTranslateState.test.js
```

Expected: FAIL，状态模块不存在。

- [ ] **Step 3: 实现纯状态派生函数**

状态标签固定为中文：上传扫描、等待开始、排队中、翻译中、写入文件、校验文件、已完成、部分完成、失败。`progressPercent` 对 translating 使用 `processedUnique / totalUnique`；writing 返回 95；validating 返回 98；completed 返回 100。`completionNotice` 只从计数和状态派生，不读取单元格内容。

- [ ] **Step 4: 实现 ExcelTranslatePage 两阶段交互**

页面必须包含：单文件 Dragger；`.xlsx,.xlsm` accept；上传后扫描卡片；Sheet/公式/候选单元格/唯一文本统计；外部翻译提示；有公式时的阅读型副本 Alert；开始按钮；进度条；当前阶段和适用时 Sheet；成功/跳过/失败计数；失败时显示后端映射的安全中文 `errorMessage`；全部 skipped 完成时显示 `completionNotice`；下载、重新上传按钮。

轮询 effect 结构：

```js
useEffect(() => {
  if (!jobId) return undefined;
  let cancelled = false;
  let timer;
  const poll = async () => {
    try {
      const next = await fetchJob(jobId);
      if (cancelled) return;
      setJob(next);
      if (shouldPoll(next)) timer = window.setTimeout(poll, 10_000);
    } catch (error) {
      if (cancelled) return;
      if (error.response?.status === 404) clearExpiredJob();
      else timer = window.setTimeout(poll, 10_000);
    }
  };
  poll();
  return () => { cancelled = true; window.clearTimeout(timer); };
}, [jobId]);
```

任务创建只能在文件选择处理函数中发生，不能在 effect 中发生，以避免 React StrictMode 双创建。保存 jobId 到 localStorage；404 时 `clearExpiredJob()` 清除 jobId 并提示重新上传，其他短暂网络错误保留当前进度并在 10 秒后继续查询，不重新创建任务。下载使用现有 `downloadBlob` 和 API 返回的 `downloadName`。

- [ ] **Step 5: 把页面加入 App.jsx**

移除未使用的 `useEffect` import；导入 `ExcelTranslatePage`；菜单增加与“走货明细”和 A-DOC 并列的 `{ key: 'excel-translate', icon: <FileExcelOutlined />, label: 'Excel 中英翻译' }`；用 `PAGE_TITLES` 映射替代嵌套三元表达式；Content 挂载新页面。

- [ ] **Step 6: 修复本地 Vite 局域网监听和代理**

```js
server: {
  host: '0.0.0.0',
  port: 3001,
  proxy: {
    '/api': {
      target: process.env.VITE_API_PROXY || 'http://127.0.0.1:80',
      changeOrigin: true,
    },
  },
},
```

保持 `base: '/zouhuo/'` 不变，且保留后端现有默认端口 80；Task 8 验收才通过 `VITE_API_PROXY=http://127.0.0.1:3002` 覆盖。

- [ ] **Step 7: 运行前端测试、lint 和生产构建**

Run:

```bash
cd 'apps/工程部/A-doc生成系統/client'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  src/pages/excelTranslateState.test.js
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run lint
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run build
```

Expected: 测试 PASS、ESLint 0 errors、Vite build 成功。

- [ ] **Step 8: 提交前端页面**

```bash
git add 'apps/工程部/A-doc生成系統/client/src/pages/excelTranslateState.js' \
  'apps/工程部/A-doc生成系統/client/src/pages/excelTranslateState.test.js' \
  'apps/工程部/A-doc生成系統/client/src/pages/ExcelTranslatePage.jsx' \
  'apps/工程部/A-doc生成系統/client/src/App.jsx' \
  'apps/工程部/A-doc生成系統/client/package.json' \
  'apps/工程部/A-doc生成系統/client/vite.config.js'
git commit -m 'feat(zouhuo): add Excel translation page'
```

---

### Task 8: 黄金文件、真实 VBA 闸门和端到端验收

**Files:**
- Create: `apps/工程部/A-doc生成系統/server/test/goldenWorkbook.test.js`
- Create: `apps/工程部/A-doc生成系統/server/test/helpers/createMacroFixture.py`

**Interfaces:**
- Consumes: Task 3/4 翻译和完整性接口、用户 29-Sheet 文件、临时生成的真实 VBA `.xlsm`。
- Produces: 可通过环境变量运行的黄金往返测试；不把用户工作簿或 VBA 二进制提交进 Git。

- [ ] **Step 1: 写黄金往返测试**

`goldenWorkbook.test.js` 读取：

```js
const goldenXlsx = process.env.GOLDEN_XLSX;
const macroXlsm = process.env.MACRO_XLSM;
```

先实现 `runGoldenXlsxGate`、`runMacroXlsmGate` 两个完整测试函数，再注册 `test('29-sheet golden workbook round trip', { skip: !goldenXlsx }, runGoldenXlsxGate)` 和 `test('macro workbook round trip', { skip: !macroXlsm }, runMacroXlsmGate)`。设置路径时使用确定性假 provider 翻译副本，断言：29 Sheet 输入仍为 29 Sheet；名称/顺序/可见性、公式、合并、样式、受保护部件通过完整性校验；第二次翻译 `changedCells.size === 0`；`.xlsm` 的 `xl/vbaProject.bin`和相关 `.rels` 哈希不变，规范化后的宏 Content-Type 声明不变。输出写到 `/tmp/zouhuo-translation-verification/` 供 Excel 人工打开。

- [ ] **Step 2: 写真实 VBA fixture 生成器**

`createMacroFixture.py` 接收两个参数：`vbaProject.bin` 路径和输出 `.xlsm` 路径，使用 bundled `xlsxwriter`：

```python
import base64
from io import BytesIO
import sys
import xlsxwriter

vba_bin, output = sys.argv[1], sys.argv[2]
workbook = xlsxwriter.Workbook(output)
workbook.add_vba_project(vba_bin)
sheet = workbook.add_worksheet('MacroSheet')
sheet.write('A1', '卡车车身')
sheet.insert_button('B2', {'macro': 'say_hello', 'caption': 'Run macro'})
sheet.write_row('A4', ['Item', 'Value'])
sheet.write_column('A5', ['One', 'Two'])
sheet.write_column('B5', [1, 2])
png = BytesIO(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
    'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
))
sheet.insert_image('D2', 'fixture.png', {'image_data': png, 'x_scale': 32, 'y_scale': 32})
chart = workbook.add_chart({'type': 'column'})
chart.add_series({
    'categories': '=MacroSheet!$A$5:$A$6',
    'values': '=MacroSheet!$B$5:$B$6',
})
sheet.insert_chart('D8', chart)
workbook.close()
```

该脚本和测试不下载文件；VBA 二进制只放 `/tmp`，不得加入 Git。生成结果必须同时包含 VBA、按钮/VML、`xl/media/` 图片和 `xl/charts/` 图表，避免把宏与图形保真分成两个不重叠的样本。

- [ ] **Step 3: 运行所有自动化测试和构建**

Run:

```bash
cd 'apps/工程部/A-doc生成系統/server'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/*.test.js
cd '../client'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test src/pages/*.test.js
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run lint
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run build
```

Expected: 全部 PASS，lint/build 成功。

- [ ] **Step 4: 运行用户 29-Sheet 黄金文件测试**

Run:

```bash
cd 'apps/工程部/A-doc生成系統/server'
GOLDEN_XLSX='/Users/duanlei/Library/CloudStorage/SynologyDrive-dl/47193C -  JD FARMIN FRIENDS JOHNNY COREYT 2#农场朋友组合(2).xlsx' \
  /Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test test/goldenWorkbook.test.js
```

Expected: PASS；日志只输出 Sheet/公式/候选/成功/失败数量和输出路径，不输出单元格文本。

- [ ] **Step 5: 生成并验证真实宏工作簿**

经网络审批后，从 XlsxWriter 官方仓库下载测试 VBA 二进制到临时目录：

```bash
curl -L 'https://raw.githubusercontent.com/jmcnamara/libxlsxwriter/main/examples/vbaProject.bin' \
  -o /tmp/zouhuo-vbaProject.bin
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  test/helpers/createMacroFixture.py \
  /tmp/zouhuo-vbaProject.bin \
  /tmp/zouhuo-macro-fixture.xlsm
MACRO_XLSM='/tmp/zouhuo-macro-fixture.xlsm' \
  /Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test test/goldenWorkbook.test.js
```

Expected: PASS；`/tmp/zouhuo-translation-verification/` 中的输出仍包含同 SHA-256 的 `xl/vbaProject.bin`，且 `xl/media/`、`xl/charts/`、drawing/VML 和对应 `.rels` 的路径集合与哈希全部不变。

- [ ] **Step 6: 用 Microsoft Excel 完成保真闸门**

打开 29-Sheet 输出和真实宏输出，确认没有“发现不可读取的内容”或修复提示；逐一查看 29 个 Sheet 的格式、图片位置、合并单元格和富文本；在宏工作簿中确认图片、柱状图和按钮位置/显示正常，再点击 `Run macro` 确认宏仍执行。任何一项失败都阻断本功能首版完成并返回 Task 3/4 修复；不能以隐藏 `.xlsm`、改成 `.xlsx` 或在 UI 中开放不安全输出的方式绕过闸门。

- [ ] **Step 7: 启动本地服务并做浏览器端到端测试**

终端一（server）：

```bash
cd 'apps/工程部/A-doc生成系統/server'
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/seed-users.js
JWT_SECRET='codex-local-translation-verification' \
PORT=3002 \
CORS_ORIGIN='http://localhost:3001,http://127.0.0.1:3001,http://192.168.5.1:3001' \
  /Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node app.js
```

终端二（client）：

```bash
cd 'apps/工程部/A-doc生成系統/client'
VITE_API_PROXY='http://127.0.0.1:3002' \
/Users/duanlei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run dev
```

使用 `browser:control-in-app-browser` 依次验证：登录；打开独立菜单；上传小型 `.xlsx`；扫描统计；公式提示；开始；10 秒轮询；成功下载；再次上传输出不重复；未登录 API 返回 401；本机 `http://127.0.0.1:3001/zouhuo/` 和局域网 `http://192.168.5.1:3001/zouhuo/` 均可访问。局部/完全提供方失败由 Task 2、5 的可注入假实现自动测试覆盖，生产 UI 不增加故障开关。

- [ ] **Step 8: 检查改动范围并提交验收测试**

```bash
git status --short
git diff --check
git add 'apps/工程部/A-doc生成系統/server/test/goldenWorkbook.test.js' \
  'apps/工程部/A-doc生成系統/server/test/helpers/createMacroFixture.py'
git commit -m 'test(zouhuo): add workbook translation acceptance gates'
```

Expected: `git status --short` 不出现用户工作簿、`/tmp` 文件、`node_modules`、新 pnpm lock 或原主工作树的未跟踪文件。

- [ ] **Step 9: 最终回归和代码审查**

使用 `superpowers:verification-before-completion` 重新运行服务端测试、前端测试、lint、build、黄金 `.xlsx` 和宏 `.xlsm` 闸门；然后使用 `superpowers:requesting-code-review` 检查需求覆盖、错误路径、日志隐私、任务所有权和工作簿保真。仅在所有证据通过后才报告功能完成。
