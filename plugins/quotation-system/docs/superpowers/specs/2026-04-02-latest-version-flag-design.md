# Design: 上传报价表自动标记最新版本

**Date:** 2026-04-02  
**Status:** Approved

## 背景

每次上传新日期的报价表时，系统会创建新的 `QuoteVersion` 记录，但没有机制标记哪个版本是"最新"的。用户期望每次上传后，系统自动以最新日期的报价表为当前默认版本。

## 目标

1. 每次上传成功后，自动将该产品的当前版本标记为最新（`is_latest = 1`）
2. 版本名称（`version_name`）改为使用 `date_code`（如 `20260310`），而非工作表名
3. 历史版本保留，`is_latest = 0`

## 不在范围内

- 前端版本列表 UI 改动（`is_latest` 字段已可供前端将来使用）
- 自动跳转逻辑（现有行为已满足：上传返回 `versionId`，前端直接跳转）

## 数据库变更

`QuoteVersion` 表新增字段：

```sql
ALTER TABLE QuoteVersion ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 0;
```

初始化时对每个产品，将 `date_code` 最大的版本设为 `is_latest = 1`（迁移脚本）。

## 后端变更

### `server/services/db.js`

建表语句 `QuoteVersion` 加入 `is_latest INTEGER NOT NULL DEFAULT 0`。

加入初始化迁移逻辑：如果列不存在则执行 `ALTER TABLE` 并对现有数据做一次性修复。

### `server/routes/import.js`

两处改动：

1. **`version_name` 改用 `date_code`**  
   - INSERT 新版本时：`version_name = data.product.date_code`  
   - UPDATE 已有版本时：同步更新 `version_name = data.product.date_code`

2. **事务完成后设置 `is_latest`**（在 `insertAll()` 调用之后）：
   ```js
   db.prepare('UPDATE QuoteVersion SET is_latest = 0 WHERE product_id = ?').run(product.id);
   db.prepare('UPDATE QuoteVersion SET is_latest = 1 WHERE id = ?').run(versionId);
   ```

## 数据流

```
上传 Excel
  → 解析 date_code（如 20260310）
  → upsert Product（by item_no）
  → upsert QuoteVersion（by source_sheet，version_name = date_code）
  → insertAll 写入所有数据
  → 清除同产品所有 is_latest
  → 设当前版本 is_latest = 1
  → 返回 { versionId, ... }
  → 前端自动跳转到该版本
```

## 兼容性

- `source_sheet` 保留不变，继续用于去重判断
- 现有版本的 `version_name` 会在下次上传时自动更新为 `date_code`
- `is_latest` 默认 0，不影响现有查询
