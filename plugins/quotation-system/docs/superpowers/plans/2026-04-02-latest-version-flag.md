# Latest Version Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每次上传报价表后，自动将该产品的当前版本标记为最新（`is_latest = 1`），并用 `date_code` 作为版本名称。

**Architecture:** 在 `QuoteVersion` 表加 `is_latest` 字段；`db.js` 加迁移逻辑；`import.js` 在写入数据后更新 `is_latest` 并将 `version_name` 改为 `date_code`。

**Tech Stack:** Node.js, better-sqlite3, Express

---

## File Map

| 文件 | 改动 |
|------|------|
| `server/services/db.js` | 迁移：加 `is_latest` 字段，对现有数据做一次性初始化 |
| `server/routes/import.js` | 1) `version_name` 改用 `date_code`；2) 事务后设置 `is_latest` |

---

### Task 1: db.js — 迁移加 `is_latest` 字段

**Files:**
- Modify: `server/services/db.js`

- [ ] **Step 1: 在现有迁移块末尾加 `is_latest` 迁移**

在 `db.js` 里找到最后一段迁移（`eng_name to RotocastItem`），在其后加入：

```js
  // Migrate: add is_latest to QuoteVersion
  if (!existingCols.includes('is_latest')) {
    db.exec("ALTER TABLE QuoteVersion ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 0");
    // One-time: mark the latest version per product (highest date_code)
    db.exec(`
      UPDATE QuoteVersion
      SET is_latest = 1
      WHERE id IN (
        SELECT id FROM QuoteVersion qv1
        WHERE date_code = (
          SELECT MAX(date_code) FROM QuoteVersion qv2
          WHERE qv2.product_id = qv1.product_id
        )
      )
    `);
  }
```

- [ ] **Step 2: 启动服务器验证迁移无报错**

```bash
cd D:/Projects/报价
node server/server.js
```

预期输出：`Server running on http://localhost:3000`（无报错）

- [ ] **Step 3: 用 sqlite3 CLI 确认字段已加入**

```bash
cd D:/Projects/报价/server/data
sqlite3 quotation.db "PRAGMA table_info(QuoteVersion);"
```

预期：输出中包含 `is_latest` 列。

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/报价
git add server/services/db.js
git commit -m "feat: add is_latest field to QuoteVersion with migration"
```

---

### Task 2: import.js — version_name 改用 date_code

**Files:**
- Modify: `server/routes/import.js`

- [ ] **Step 1: 修改 INSERT 新版本时的 version_name**

找到 `import.js` 里 INSERT QuoteVersion 的语句（约第 50 行附近）：

```js
      const vr = db.prepare(
        `INSERT INTO QuoteVersion (product_id, version_name, source_sheet, date_code, quote_date, status, format_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      ).run(product.id, versionName, data.sheetName, data.product.date_code, data.product.date_code, data.format_type || 'injection', now, now);
```

将 `versionName`（工作表名）改为 `data.product.date_code`：

```js
      const vr = db.prepare(
        `INSERT INTO QuoteVersion (product_id, version_name, source_sheet, date_code, quote_date, status, format_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      ).run(product.id, data.product.date_code, data.sheetName, data.product.date_code, data.product.date_code, data.format_type || 'injection', now, now);
```

- [ ] **Step 2: 修改 UPDATE 已有版本时同步 version_name**

找到 `import.js` 里 UPDATE QuoteVersion 的语句：

```js
      db.prepare(`UPDATE QuoteVersion SET date_code=?, quote_date=?, format_type=?, updated_at=? WHERE id=?`)
        .run(data.product.date_code, data.product.date_code, data.format_type || 'injection', now, versionId);
```

加入 `version_name` 更新：

```js
      db.prepare(`UPDATE QuoteVersion SET version_name=?, date_code=?, quote_date=?, format_type=?, updated_at=? WHERE id=?`)
        .run(data.product.date_code, data.product.date_code, data.product.date_code, data.format_type || 'injection', now, versionId);
```

- [ ] **Step 3: Commit**

```bash
cd D:/Projects/报价
git add server/routes/import.js
git commit -m "feat: use date_code as version_name on import"
```

---

### Task 3: import.js — 事务后设置 is_latest

**Files:**
- Modify: `server/routes/import.js`

- [ ] **Step 1: 在 `insertAll()` 调用之后加 is_latest 更新**

找到 `import.js` 里 `insertAll();` 这一行，在其**正下方**加入：

```js
    insertAll();

    // Mark this version as latest for this product
    db.prepare('UPDATE QuoteVersion SET is_latest = 0 WHERE product_id = ?').run(product.id);
    db.prepare('UPDATE QuoteVersion SET is_latest = 1 WHERE id = ?').run(versionId);
```

- [ ] **Step 2: 手动测试上传一个 Excel 文件**

启动服务器后，通过前端上传一个报价表，然后执行：

```bash
cd D:/Projects/报价/server/data
sqlite3 quotation.db "SELECT id, version_name, date_code, is_latest FROM QuoteVersion ORDER BY product_id, id;"
```

预期：刚上传的版本 `is_latest = 1`，同产品其他版本 `is_latest = 0`。

- [ ] **Step 3: 再上传同产品的另一个日期版本，验证 is_latest 转移**

上传同一产品但不同 sheet 名（不同日期）的文件，然后再次查询：

```bash
sqlite3 quotation.db "SELECT id, version_name, date_code, is_latest FROM QuoteVersion ORDER BY product_id, id;"
```

预期：新上传的版本 `is_latest = 1`，旧版本 `is_latest = 0`。

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/报价
git add server/routes/import.js
git commit -m "feat: set is_latest=1 on imported version, clear others for same product"
```
