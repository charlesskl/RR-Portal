-- 新原料领料按明确啤机采购来源与冻结用量占额；历史空来源不回填。
IF COL_LENGTH(N'dbo.原料出库明细单', N'来源啤机采购单号') IS NULL
    ALTER TABLE [dbo].[原料出库明细单] ADD [来源啤机采购单号] nvarchar(80) NULL;

-- 冻结库存用量及包换算使用8位；扩精度保留原数值，避免带单后静默舍入。
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.原料出库单') AND name=N'数量' AND scale<8)
    ALTER TABLE [dbo].[原料出库单] ALTER COLUMN [数量] decimal(28,8) NULL;
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.原料出库明细单') AND name=N'数量' AND scale<8)
    ALTER TABLE [dbo].[原料出库明细单] ALTER COLUMN [数量] decimal(28,8) NULL;
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.原料出库明细单') AND name=N'每包重量' AND scale<8)
    ALTER TABLE [dbo].[原料出库明细单] ALTER COLUMN [每包重量] decimal(28,8) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.原料出库明细单')
               AND name=N'IX_原料出库明细单_啤机来源原料')
    EXEC(N'CREATE INDEX [IX_原料出库明细单_啤机来源原料]
        ON [dbo].[原料出库明细单]([来源啤机采购单号],[原料编号])
        INCLUDE([单号],[数量],[单位],[每包重量]) WHERE [来源啤机采购单号] IS NOT NULL');
