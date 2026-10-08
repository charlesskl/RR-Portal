-- 生产通知单（一单多货号）第①片：单头加列 + 生产制单货号表 + 子表/P4 加货号列 + 数据回填。幂等(可重跑)。
-- 不加 FK(应用层保证);不 drop/rename。EXEC(N'...') 包裹引用新列的 ALTER/回填，避免单批次编译期引用未建列报错。
SET XACT_ABORT ON;

-- 1) 单头 生产制单 新增列（COL_LENGTH 判断后 ALTER ADD）
IF COL_LENGTH(N'生产制单', N'订单类型') IS NULL
    ALTER TABLE [生产制单] ADD [订单类型] nvarchar(10) NULL;
IF COL_LENGTH(N'生产制单', N'标识') IS NULL
    ALTER TABLE [生产制单] ADD [标识] nvarchar(10) NULL;
IF COL_LENGTH(N'生产制单', N'装箱方式') IS NULL
    ALTER TABLE [生产制单] ADD [装箱方式] nvarchar(10) NULL;
IF COL_LENGTH(N'生产制单', N'订单总箱数') IS NULL
    ALTER TABLE [生产制单] ADD [订单总箱数] int NULL;
IF COL_LENGTH(N'生产制单', N'默认单价') IS NULL
    ALTER TABLE [生产制单] ADD [默认单价] nvarchar(20) NULL;

-- 2) 新建 生产制单货号（货号明细网格）。无 FK。
IF OBJECT_ID(N'生产制单货号', N'U') IS NULL
    CREATE TABLE [生产制单货号](
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [生产单号] nvarchar(30) NOT NULL,
        [序号] int NULL,
        [货号] nvarchar(40) NULL,
        [BOM款号] nvarchar(40) NULL,
        [款号名称] nvarchar(60) NULL,
        [数量] decimal(18,4) NULL,
        [比例] decimal(18,4) NULL,
        [分析] bit NULL CONSTRAINT [DF_生产制单货号_分析] DEFAULT(0)
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产制单货号_生产单号')
    CREATE INDEX [IX_生产制单货号_生产单号] ON [生产制单货号]([生产单号]);

-- 3) 子表 + P4 加 货号 列（COL_LENGTH 判断）
IF COL_LENGTH(N'生产制单数量', N'货号') IS NULL
    ALTER TABLE [生产制单数量] ADD [货号] nvarchar(40) NULL;
IF COL_LENGTH(N'生产制单工序表', N'货号') IS NULL
    ALTER TABLE [生产制单工序表] ADD [货号] nvarchar(40) NULL;
IF COL_LENGTH(N'生产BOM物料清单', N'货号') IS NULL
    ALTER TABLE [生产BOM物料清单] ADD [货号] nvarchar(40) NULL;
IF COL_LENGTH(N'裁床总表', N'货号') IS NULL
    ALTER TABLE [裁床总表] ADD [货号] nvarchar(40) NULL;
IF COL_LENGTH(N'计件表', N'货号') IS NULL
    ALTER TABLE [计件表] ADD [货号] nvarchar(40) NULL;

-- 4) 数据回填（幂等，WHERE 货号 IS NULL）。用 EXEC(N'...') 在运行期编译，确保上面新列已存在。
EXEC(N'UPDATE [生产制单数量] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL;');
EXEC(N'UPDATE [生产制单工序表] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL;');
EXEC(N'UPDATE [生产BOM物料清单] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL;');
EXEC(N'UPDATE [裁床总表] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL;');
-- 计件表 无 款号 列 → 经 裁床单号 关联 裁床总表.款号 回填
EXEC(N'UPDATE q SET q.[货号]=c.[款号] FROM [计件表] q
       JOIN [裁床总表] c ON c.[裁床单号]=q.[裁床单号]
       WHERE q.[货号] IS NULL AND c.[款号] IS NOT NULL;');
-- 生产制单货号：既有 生产制单 每单合成一行（幂等：不存在才插）
EXEC(N'INSERT INTO [生产制单货号]([生产单号],[序号],[货号],[BOM款号],[款号名称],[数量],[比例],[分析])
       SELECT p.[生产单号],1,p.[款号],p.[款号],p.[款式],p.[计划数量],1,0
       FROM [生产制单] p
       WHERE p.[款号] IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM [生产制单货号] g WHERE g.[生产单号]=p.[生产单号]);');
