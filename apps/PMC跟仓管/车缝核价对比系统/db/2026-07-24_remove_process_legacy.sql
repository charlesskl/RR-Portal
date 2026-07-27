/* 工序定价遗留清理：产品核价彻底收敛为“一款一价”。幂等执行。 */
USE [StitchCostPro];
GO

/* 同一款遗留多条工序核价时，优先保留产品级记录，其次保留最近更新的一条。 */
IF OBJECT_ID(N'dbo.product_quote', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.product_quote', N'category_id') IS NOT NULL
BEGIN
    EXEC sp_executesql N';WITH ranked AS (
        SELECT quote_id,
               ROW_NUMBER() OVER (
                   PARTITION BY product_id
                   ORDER BY CASE WHEN category_id IS NULL THEN 0 ELSE 1 END,
                            COALESCE(updated_at, created_at) DESC,
                            quote_id DESC
               ) AS rn
        FROM dbo.product_quote
    )
    DELETE FROM ranked WHERE rn > 1;';
END
GO

/* 删除所有指向旧工序体系表的外键。 */
DECLARE @dropFk NVARCHAR(MAX) = N'';
SELECT @dropFk += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' +
    QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.foreign_keys
WHERE referenced_object_id IN (
    OBJECT_ID(N'dbo.process_category'), OBJECT_ID(N'dbo.process_item'),
    OBJECT_ID(N'dbo.craft_rate'), OBJECT_ID(N'dbo.process_timing'),
    OBJECT_ID(N'dbo.markup_rate'), OBJECT_ID(N'dbo.outsource_price'),
    OBJECT_ID(N'dbo.compliance_check'), OBJECT_ID(N'dbo.price_markup_log'),
    OBJECT_ID(N'dbo.outsource_assignment'), OBJECT_ID(N'dbo.comparison_snapshot'),
    OBJECT_ID(N'dbo.price_monitor')
);
IF @dropFk <> N'' EXEC sp_executesql @dropFk;
GO

/* 删除依赖 product_quote / purchase_order_line.category_id 的外键和索引。 */
DECLARE @dropCategoryDeps NVARCHAR(MAX) = N'';
SELECT @dropCategoryDeps += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(fk.parent_object_id)) + N'.' +
    QUOTENAME(OBJECT_NAME(fk.parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + CHAR(10)
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE c.name = N'category_id'
  AND fkc.parent_object_id IN (OBJECT_ID(N'dbo.product_quote'), OBJECT_ID(N'dbo.purchase_order_line'));
IF @dropCategoryDeps <> N'' EXEC sp_executesql @dropCategoryDeps;
GO

DECLARE @dropIndexes NVARCHAR(MAX) = N'';
SELECT @dropIndexes += N'DROP INDEX ' + QUOTENAME(i.name) + N' ON ' +
    QUOTENAME(OBJECT_SCHEMA_NAME(i.object_id)) + N'.' + QUOTENAME(OBJECT_NAME(i.object_id)) + N';' + CHAR(10)
FROM sys.indexes i
WHERE i.is_primary_key = 0 AND i.is_unique_constraint = 0
  AND i.object_id IN (OBJECT_ID(N'dbo.product_quote'), OBJECT_ID(N'dbo.purchase_order_line'))
  AND EXISTS (
      SELECT 1 FROM sys.index_columns ic
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = N'category_id'
  );
IF @dropIndexes <> N'' EXEC sp_executesql @dropIndexes;
GO

DECLARE @dropUniqueConstraints NVARCHAR(MAX) = N'';
SELECT @dropUniqueConstraints += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(k.parent_object_id)) + N'.' +
    QUOTENAME(OBJECT_NAME(k.parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(k.name) + N';' + CHAR(10)
FROM sys.key_constraints k
WHERE k.type = N'UQ'
  AND k.parent_object_id IN (OBJECT_ID(N'dbo.product_quote'), OBJECT_ID(N'dbo.purchase_order_line'))
  AND EXISTS (
      SELECT 1 FROM sys.index_columns ic
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE ic.object_id = k.parent_object_id AND ic.index_id = k.unique_index_id AND c.name = N'category_id'
  );
IF @dropUniqueConstraints <> N'' EXEC sp_executesql @dropUniqueConstraints;
GO

IF COL_LENGTH(N'dbo.product_quote', N'category_id') IS NOT NULL
    ALTER TABLE dbo.product_quote DROP COLUMN category_id;
IF COL_LENGTH(N'dbo.purchase_order_line', N'category_id') IS NOT NULL
    ALTER TABLE dbo.purchase_order_line DROP COLUMN category_id;
GO

IF OBJECT_ID(N'dbo.product_quote', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.product_quote') AND name = N'UX_product_quote_product')
    CREATE UNIQUE INDEX UX_product_quote_product ON dbo.product_quote(product_id);
GO

/* 这些表仅服务于旧“款式×工序”定价、打秒及价格监控模型。 */
DROP TABLE IF EXISTS dbo.price_monitor;
DROP TABLE IF EXISTS dbo.comparison_snapshot;
DROP TABLE IF EXISTS dbo.outsource_assignment;
DROP TABLE IF EXISTS dbo.price_markup_log;
DROP TABLE IF EXISTS dbo.compliance_check;
DROP TABLE IF EXISTS dbo.outsource_price;
DROP TABLE IF EXISTS dbo.process_timing;
DROP TABLE IF EXISTS dbo.markup_rate;
DROP TABLE IF EXISTS dbo.craft_rate;
DROP TABLE IF EXISTS dbo.process_item;
DROP TABLE IF EXISTS dbo.process_category;
GO

PRINT N'====== 工序定价遗留已清理：每款产品唯一总价 ======';
GO
