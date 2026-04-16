---
phase: 04-v1-1-gap-fix
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - server/routes/versions.js
autonomous: true
requirements:
  - FIX2-03

must_haves:
  truths:
    - "复制任意毛绒公仔版本后，新版本的 format_type 与原版本相同（不为 NULL）"
  artifacts:
    - path: "server/routes/versions.js"
      provides: "duplicate endpoint，INSERT 语句含 format_type 列"
      contains: "format_type"
  key_links:
    - from: "POST /:id/duplicate"
      to: "QuoteVersion.format_type"
      via: "INSERT column list + VALUES clause"
      pattern: "format_type.*version\\.format_type"
---

<objective>
修复版本复制端点（POST /:id/duplicate）中 INSERT 语句漏传 format_type 字段的 bug。

Purpose: 复制毛绒公仔版本时，新版本 format_type 从 NULL 变为与原版本一致的值，避免后续导出功能取值错误。
Output: server/routes/versions.js 中 duplicate 端点的 INSERT 语句新增 format_type 列及对应绑定值。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: 在 duplicate INSERT 中补充 format_type 字段</name>
  <files>server/routes/versions.js</files>
  <read_first>server/routes/versions.js（重点阅读第 129–147 行，即 POST /:id/duplicate 路由中 QuoteVersion INSERT 语句）</read_first>
  <action>
在 `POST /:id/duplicate` 路由的 QuoteVersion INSERT 语句中做以下两处修改：

1. 在列名列表末尾追加 `format_type`：
   ```sql
   INSERT INTO QuoteVersion (product_id, version_name, source_sheet, date_code, quote_date, status,
     item_rev, prepared_by, quote_rev, fty_delivery_date, body_no, bd_prepared_by, bd_date, body_cost_revision,
     format_type)
   ```

2. 在 VALUES 绑定末尾追加 `version.format_type`：
   ```js
   .run(version.product_id, newName, version.source_sheet, version.date_code, version.quote_date,
     version.item_rev, version.prepared_by, version.quote_rev, version.fty_delivery_date,
     version.body_no, version.bd_prepared_by, version.bd_date, version.body_cost_revision,
     version.format_type);
   ```

只改这两处，不动其他任何逻辑。
  </action>
  <verify>
    <automated>grep -n "format_type" server/routes/versions.js</automated>
  </verify>
  <acceptance_criteria>
- `grep -n "format_type" server/routes/versions.js` 输出至少两行：一行在列名列表，一行在 `.run(...)` 绑定值处
- 两处均位于 `POST /:id/duplicate` 路由的 QuoteVersion INSERT 块内（约第 140–146 行附近）
- 文件中不存在语法错误（node -e "require('./server/routes/versions.js')" 执行无报错）
  </acceptance_criteria>
  <done>duplicate 端点 INSERT 语句同时包含 format_type 列名和对应绑定值，复制后新版本 format_type 不再为 NULL</done>
</task>

</tasks>

<verification>
```bash
# 1. 确认 format_type 出现在 duplicate INSERT 中
grep -n "format_type" server/routes/versions.js

# 2. 确认模块可正常加载（无语法错误）
node -e "require('./server/routes/versions.js')" 2>&1
```
</verification>

<success_criteria>
1. `grep` 输出在 versions.js 的 duplicate 路由中找到 `format_type`（列名 + 绑定值各一处）
2. `node -e require(...)` 无报错输出
3. 复制一个 format_type = 'plush' 的版本后，新版本 format_type 仍为 'plush'
</success_criteria>

<output>
完成后创建 `.planning/phases/04-v1-1-gap-fix/04-01-SUMMARY.md`
</output>
