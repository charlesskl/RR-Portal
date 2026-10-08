DECLARE @必需列 TABLE (
    [表名] sysname NOT NULL,
    [列名] sysname NOT NULL,
    [类型] sysname NOT NULL,
    [最大字节] smallint NOT NULL,
    [精度] tinyint NOT NULL,
    [小数位] tinyint NOT NULL,
    [可空] bit NOT NULL,
    [自增] bit NOT NULL,
    [默认约束] sysname NULL,
    [默认值] nvarchar(100) NULL
);

INSERT INTO @必需列 VALUES
    (N'半成品标签单', N'ID', N'bigint', 8, 19, 0, 0, 1, NULL, NULL),
    (N'半成品标签单', N'电脑单号', N'nvarchar', 80, 0, 0, 0, 0, NULL, NULL),
    (N'半成品标签单', N'日期', N'date', 3, 10, 0, 0, 0, NULL, NULL),
    (N'半成品标签单', N'备注一', N'nvarchar', 1000, 0, 0, 1, 0, NULL, NULL),
    (N'半成品标签单', N'备注二', N'nvarchar', 1000, 0, 0, 1, 0, NULL, NULL),
    (N'半成品标签单', N'操作员', N'nvarchar', 160, 0, 0, 0, 0, NULL, NULL),
    (N'半成品标签单', N'审核', N'char', 1, 0, 0, 0, 0, N'DF_半成品标签单_审核', N'''0'''),
    (N'半成品标签单', N'审核人', N'nvarchar', 160, 0, 0, 1, 0, NULL, NULL),
    (N'半成品标签单', N'审核时间', N'datetime2', 8, 27, 7, 1, 0, NULL, NULL),
    (N'半成品标签单', N'创建时间', N'datetime2', 8, 27, 7, 0, 0, N'DF_半成品标签单_创建时间', N'sysdatetime'),
    (N'半成品标签单', N'更新时间', N'datetime2', 8, 27, 7, 0, 0, N'DF_半成品标签单_更新时间', N'sysdatetime'),
    (N'半成品标签明细', N'ID', N'bigint', 8, 19, 0, 0, 1, NULL, NULL),
    (N'半成品标签明细', N'标签单ID', N'bigint', 8, 19, 0, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'行号', N'int', 4, 10, 0, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'配件编号', N'nvarchar', 160, 0, 0, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'客户', N'nvarchar', 320, 0, 0, 1, 0, NULL, NULL),
    (N'半成品标签明细', N'产品货号', N'nvarchar', 240, 0, 0, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'产品名称', N'nvarchar', 480, 0, 0, 1, 0, NULL, NULL),
    (N'半成品标签明细', N'产品装配名称', N'nvarchar', 480, 0, 0, 1, 0, NULL, NULL),
    (N'半成品标签明细', N'数量', N'decimal', 9, 18, 4, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'每箱数量', N'decimal', 9, 18, 4, 1, 0, NULL, NULL),
    (N'半成品标签明细', N'预计标签数', N'int', 4, 10, 0, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'实需标签数', N'int', 4, 10, 0, 0, 0, NULL, NULL),
    (N'半成品标签明细', N'实需标签数已手改', N'bit', 1, 1, 0, 0, 0, N'DF_半成品标签明细_手改', N'0'),
    (N'半成品标签明细', N'备注', N'nvarchar', 1000, 0, 0, 1, 0, NULL, NULL);

IF EXISTS (
    SELECT 1
    FROM @必需列 AS [e]
    LEFT JOIN sys.columns AS [c]
      ON [c].[object_id] = OBJECT_ID(QUOTENAME([e].[表名]))
     AND [c].[name] COLLATE DATABASE_DEFAULT = [e].[列名]
    LEFT JOIN sys.types AS [t] ON [t].[user_type_id] = [c].[user_type_id]
    LEFT JOIN sys.default_constraints AS [d] ON [d].[object_id] = [c].[default_object_id]
    CROSS APPLY (VALUES (LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE([d].[definition], N''), N'(', N''), N')', N''), N' ', N''), CHAR(9), N'')))) AS [n]([默认值])
    WHERE [c].[column_id] IS NULL
       OR [t].[name] COLLATE DATABASE_DEFAULT <> [e].[类型]
       OR [c].[max_length] <> [e].[最大字节]
       OR [c].[precision] <> [e].[精度]
       OR [c].[scale] <> [e].[小数位]
       OR [c].[is_nullable] <> [e].[可空]
       OR [c].[is_identity] <> [e].[自增]
       OR COALESCE([d].[name] COLLATE DATABASE_DEFAULT, N'') <> COALESCE([e].[默认约束], N'')
       OR [n].[默认值] <> COALESCE([e].[默认值], N'')
)
    THROW 51120, N'成功部署后的必需列、类型、长度、nullable、identity 或默认值不符合契约', 1;

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints AS [k]
    INNER JOIN sys.indexes AS [i] ON [i].[object_id] = [k].[parent_object_id] AND [i].[index_id] = [k].[unique_index_id]
    WHERE [k].[parent_object_id] = OBJECT_ID(N'[半成品标签单]') AND [k].[name] = N'PK_半成品标签单' AND [k].[type] = 'PK'
      AND (SELECT COUNT(*) FROM sys.index_columns WHERE [object_id] = [i].[object_id] AND [index_id] = [i].[index_id]) = 1
      AND EXISTS (SELECT 1 FROM sys.index_columns AS [ic] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] = 1 AND [c].[name] = N'ID')
)
    THROW 51121, N'主表主键不符合契约', 1;

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints AS [k]
    INNER JOIN sys.indexes AS [i] ON [i].[object_id] = [k].[parent_object_id] AND [i].[index_id] = [k].[unique_index_id]
    WHERE [k].[parent_object_id] = OBJECT_ID(N'[半成品标签明细]') AND [k].[name] = N'PK_半成品标签明细' AND [k].[type] = 'PK'
      AND (SELECT COUNT(*) FROM sys.index_columns WHERE [object_id] = [i].[object_id] AND [index_id] = [i].[index_id]) = 1
      AND EXISTS (SELECT 1 FROM sys.index_columns AS [ic] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] = 1 AND [c].[name] = N'ID')
)
    THROW 51122, N'明细表主键不符合契约', 1;

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints AS [k]
    INNER JOIN sys.indexes AS [i] ON [i].[object_id] = [k].[parent_object_id] AND [i].[index_id] = [k].[unique_index_id]
    WHERE [k].[parent_object_id] = OBJECT_ID(N'[半成品标签单]') AND [k].[name] = N'UQ_半成品标签单_电脑单号' AND [k].[type] = 'UQ'
      AND (SELECT COUNT(*) FROM sys.index_columns WHERE [object_id] = [i].[object_id] AND [index_id] = [i].[index_id]) = 1
      AND EXISTS (SELECT 1 FROM sys.index_columns AS [ic] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] = 1 AND [c].[name] = N'电脑单号')
)
    THROW 51123, N'主表电脑单号唯一约束不符合契约', 1;

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints AS [k]
    INNER JOIN sys.indexes AS [i] ON [i].[object_id] = [k].[parent_object_id] AND [i].[index_id] = [k].[unique_index_id]
    WHERE [k].[parent_object_id] = OBJECT_ID(N'[半成品标签明细]') AND [k].[name] = N'UQ_半成品标签明细_标签单_行号' AND [k].[type] = 'UQ'
      AND (SELECT COUNT(*) FROM sys.index_columns WHERE [object_id] = [i].[object_id] AND [index_id] = [i].[index_id]) = 2
      AND EXISTS (SELECT 1 FROM sys.index_columns AS [ic] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] = 1 AND [c].[name] = N'标签单ID')
      AND EXISTS (SELECT 1 FROM sys.index_columns AS [ic] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] = 2 AND [c].[name] = N'行号')
)
    THROW 51124, N'明细表标签单/行号唯一约束不符合契约', 1;

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys AS [f]
    INNER JOIN sys.foreign_key_columns AS [fc] ON [fc].[constraint_object_id] = [f].[object_id]
    INNER JOIN sys.columns AS [pc] ON [pc].[object_id] = [fc].[parent_object_id] AND [pc].[column_id] = [fc].[parent_column_id]
    INNER JOIN sys.columns AS [rc] ON [rc].[object_id] = [fc].[referenced_object_id] AND [rc].[column_id] = [fc].[referenced_column_id]
    WHERE [f].[name] = N'FK_半成品标签明细_标签单'
      AND [f].[parent_object_id] = OBJECT_ID(N'[半成品标签明细]')
      AND [f].[referenced_object_id] = OBJECT_ID(N'[半成品标签单]')
      AND [pc].[name] = N'标签单ID' AND [rc].[name] = N'ID'
      AND [f].[delete_referential_action_desc] = N'CASCADE'
      AND [f].[is_disabled] = 0 AND [f].[is_not_trusted] = 0
      AND (SELECT COUNT(*) FROM sys.foreign_key_columns WHERE [constraint_object_id] = [f].[object_id]) = 1
)
    THROW 51125, N'明细到主表的级联外键不符合契约', 1;

IF EXISTS (
    SELECT [v].[约束名]
    FROM (VALUES
        (N'CK_半成品标签单_审核', OBJECT_ID(N'[半成品标签单]'), N'[审核]', N'''0''', N'''1'''),
        (N'CK_半成品标签明细_数量', OBJECT_ID(N'[半成品标签明细]'), N'[数量]', N'>=', N'0'),
        (N'CK_半成品标签明细_预计', OBJECT_ID(N'[半成品标签明细]'), N'[预计标签数]', N'>=', N'0'),
        (N'CK_半成品标签明细_实需', OBJECT_ID(N'[半成品标签明细]'), N'[实需标签数]', N'>=', N'0')
    ) AS [v]([约束名], [表ID], [标记一], [标记二], [标记三])
    LEFT JOIN sys.check_constraints AS [c] ON [c].[parent_object_id] = [v].[表ID] AND [c].[name] COLLATE DATABASE_DEFAULT = [v].[约束名]
    WHERE [c].[object_id] IS NULL OR [c].[is_disabled] = 1 OR [c].[is_not_trusted] = 1
       OR CHARINDEX([v].[标记一], [c].[definition]) = 0
       OR CHARINDEX([v].[标记二], REPLACE([c].[definition], N' ', N'')) = 0
       OR CHARINDEX([v].[标记三], [c].[definition]) = 0
)
    THROW 51126, N'检查约束不符合契约', 1;

IF EXISTS (
    SELECT [v].[索引名]
    FROM (VALUES
        (OBJECT_ID(N'[半成品标签单]'), N'IX_半成品标签单_日期_ID', 2),
        (OBJECT_ID(N'[半成品标签明细]'), N'IX_半成品标签明细_配件编号', 1)
    ) AS [v]([表ID], [索引名], [键列数])
    LEFT JOIN sys.indexes AS [i] ON [i].[object_id] = [v].[表ID] AND [i].[name] COLLATE DATABASE_DEFAULT = [v].[索引名]
    WHERE [i].[index_id] IS NULL OR [i].[is_unique] = 1 OR [i].[is_disabled] = 1 OR [i].[has_filter] = 1 OR [i].[type] <> 2
       OR (SELECT COUNT(*) FROM sys.index_columns WHERE [object_id] = [i].[object_id] AND [index_id] = [i].[index_id]) <> [v].[键列数]
)
    THROW 51127, N'必需非聚集索引的基本属性不符合契约', 1;

IF NOT EXISTS (SELECT 1 FROM sys.indexes AS [i] INNER JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [i].[object_id] = OBJECT_ID(N'[半成品标签单]') AND [i].[name] = N'IX_半成品标签单_日期_ID' AND [ic].[key_ordinal] = 1 AND [c].[name] = N'日期')
   OR NOT EXISTS (SELECT 1 FROM sys.indexes AS [i] INNER JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [i].[object_id] = OBJECT_ID(N'[半成品标签单]') AND [i].[name] = N'IX_半成品标签单_日期_ID' AND [ic].[key_ordinal] = 2 AND [c].[name] = N'ID')
   OR NOT EXISTS (SELECT 1 FROM sys.indexes AS [i] INNER JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id] WHERE [i].[object_id] = OBJECT_ID(N'[半成品标签明细]') AND [i].[name] = N'IX_半成品标签明细_配件编号' AND [ic].[key_ordinal] = 1 AND [c].[name] = N'配件编号')
    THROW 51128, N'必需非聚集索引的键列或顺序不符合契约', 1;

IF NOT EXISTS (SELECT 1 FROM [userbqrpower] WHERE [用户] = REPLICATE(N'V', 30) AND [菜单] = N'半成品标签单')
    THROW 51129, N'可无损写入的 30 字符账号未获得权限', 1;

IF EXISTS (SELECT 1 FROM [userbqrpower] WHERE [用户] = REPLICATE(N'X', 30) AND [菜单] = N'半成品标签单')
    THROW 51130, N'31 字符账号被截断并误授权给同前缀账号', 1;

IF (SELECT COUNT(*) FROM [userbqrpower] WHERE [菜单] = N'半成品标签单') <> 2
    THROW 51131, N'并发或重复 seed 后出现重复/缺失权限主体', 1;
