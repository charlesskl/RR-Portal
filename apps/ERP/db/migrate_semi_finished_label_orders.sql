-- 半成品标签单及明细。可重复执行，供标签单保存和后续查询复用。
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @锁结果 int;
    EXEC @锁结果 = sys.sp_getapplock
        @Resource = N'db.migrate_semi_finished_label_orders',
        @LockMode = N'Exclusive',
        @LockOwner = N'Transaction',
        @LockTimeout = 60000;

    IF @锁结果 < 0
        THROW 51001, N'无法取得半成品标签单 migration 锁', 1;

IF OBJECT_ID(N'[半成品标签单]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品标签单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品标签单] PRIMARY KEY,
        [电脑单号] nvarchar(40) NOT NULL,
        [日期] date NOT NULL,
        [备注一] nvarchar(500) NULL,
        [备注二] nvarchar(500) NULL,
        [操作员] nvarchar(80) NOT NULL,
        [审核] char(1) NOT NULL CONSTRAINT [DF_半成品标签单_审核] DEFAULT ('0'),
        [审核人] nvarchar(80) NULL,
        [审核时间] datetime2 NULL,
        [创建时间] datetime2 NOT NULL CONSTRAINT [DF_半成品标签单_创建时间] DEFAULT (SYSDATETIME()),
        [更新时间] datetime2 NOT NULL CONSTRAINT [DF_半成品标签单_更新时间] DEFAULT (SYSDATETIME()),
        CONSTRAINT [UQ_半成品标签单_电脑单号] UNIQUE ([电脑单号]),
        CONSTRAINT [CK_半成品标签单_审核] CHECK ([审核] IN ('0', '1'))
    );
END;

IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品标签明细] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品标签明细] PRIMARY KEY,
        [标签单ID] bigint NOT NULL,
        [行号] int NOT NULL,
        [配件编号] nvarchar(80) NOT NULL,
        [客户] nvarchar(160) NULL,
        [产品货号] nvarchar(120) NOT NULL,
        [产品名称] nvarchar(240) NULL,
        [产品装配名称] nvarchar(240) NULL,
        [数量] decimal(18,4) NOT NULL,
        [每箱数量] decimal(18,4) NULL,
        [预计标签数] int NOT NULL,
        [实需标签数] int NOT NULL,
        [实需标签数已手改] bit NOT NULL CONSTRAINT [DF_半成品标签明细_手改] DEFAULT (0),
        [备注] nvarchar(500) NULL,
        CONSTRAINT [FK_半成品标签明细_标签单]
            FOREIGN KEY ([标签单ID]) REFERENCES [半成品标签单]([ID]) ON DELETE CASCADE,
        CONSTRAINT [UQ_半成品标签明细_标签单_行号] UNIQUE ([标签单ID], [行号]),
        CONSTRAINT [CK_半成品标签明细_数量] CHECK ([数量] >= 0),
        CONSTRAINT [CK_半成品标签明细_预计] CHECK ([预计标签数] >= 0),
        CONSTRAINT [CK_半成品标签明细_实需] CHECK ([实需标签数] >= 0)
    );
END;

IF OBJECT_ID(N'[半成品标签单]', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE [name] = N'IX_半成品标签单_日期_ID'
         AND [object_id] = OBJECT_ID(N'[半成品标签单]')
   )
BEGIN
    CREATE INDEX [IX_半成品标签单_日期_ID]
        ON [半成品标签单]([日期], [ID]);
END;

IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.indexes
       WHERE [name] = N'IX_半成品标签明细_配件编号'
         AND [object_id] = OBJECT_ID(N'[半成品标签明细]')
   )
BEGIN
    CREATE INDEX [IX_半成品标签明细_配件编号]
        ON [半成品标签明细]([配件编号]);
END;

IF OBJECT_ID(N'[半成品标签单]', N'U') IS NULL
    THROW 51000, N'半成品标签单 migration did not create header table', 1;
IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NULL
    THROW 51000, N'半成品标签单 migration did not create detail table', 1;

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
    THROW 51010, N'半成品标签单已有表的列、类型、长度、nullable、identity 或默认值不符合部署契约', 1;

DECLARE @必需键列 TABLE (
    [表名] sysname NOT NULL,
    [约束名] sysname NOT NULL,
    [约束类型] char(2) NOT NULL,
    [键序] tinyint NOT NULL,
    [列名] sysname NOT NULL
);

INSERT INTO @必需键列 VALUES
    (N'半成品标签单', N'PK_半成品标签单', 'PK', 1, N'ID'),
    (N'半成品标签单', N'UQ_半成品标签单_电脑单号', 'UQ', 1, N'电脑单号'),
    (N'半成品标签明细', N'PK_半成品标签明细', 'PK', 1, N'ID'),
    (N'半成品标签明细', N'UQ_半成品标签明细_标签单_行号', 'UQ', 1, N'标签单ID'),
    (N'半成品标签明细', N'UQ_半成品标签明细_标签单_行号', 'UQ', 2, N'行号');

IF EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT [表名], [约束名], [约束类型] FROM @必需键列) AS [e]
    LEFT JOIN sys.key_constraints AS [k]
      ON [k].[parent_object_id] = OBJECT_ID(QUOTENAME([e].[表名]))
     AND [k].[name] COLLATE DATABASE_DEFAULT = [e].[约束名]
     AND [k].[type] COLLATE DATABASE_DEFAULT = [e].[约束类型]
    LEFT JOIN sys.indexes AS [i]
      ON [i].[object_id] = [k].[parent_object_id]
     AND [i].[index_id] = [k].[unique_index_id]
    WHERE [k].[object_id] IS NULL OR [i].[is_unique] <> 1 OR [i].[is_disabled] = 1 OR [i].[is_hypothetical] = 1
       OR EXISTS (
           SELECT [ic].[key_ordinal], [c].[name] COLLATE DATABASE_DEFAULT
           FROM sys.index_columns AS [ic]
           INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
           WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] > 0
           EXCEPT
           SELECT [x].[键序], [x].[列名] FROM @必需键列 AS [x] WHERE [x].[表名] = [e].[表名] AND [x].[约束名] = [e].[约束名]
       )
       OR EXISTS (
           SELECT [x].[键序], [x].[列名] FROM @必需键列 AS [x] WHERE [x].[表名] = [e].[表名] AND [x].[约束名] = [e].[约束名]
           EXCEPT
           SELECT [ic].[key_ordinal], [c].[name] COLLATE DATABASE_DEFAULT
           FROM sys.index_columns AS [ic]
           INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
           WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] > 0
       )
       OR EXISTS (SELECT 1 FROM sys.index_columns AS [ic] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[is_included_column] = 1)
)
    THROW 51011, N'半成品标签单已有表的主键或唯一约束不符合部署契约', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys AS [f]
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
    THROW 51012, N'半成品标签明细已有表的外键不符合部署契约', 1;

DECLARE @必需检查 TABLE (
    [表名] sysname NOT NULL,
    [约束名] sysname NOT NULL,
    [规范定义一] nvarchar(200) NOT NULL,
    [规范定义二] nvarchar(200) NULL
);

INSERT INTO @必需检查 VALUES
    (N'半成品标签单', N'CK_半成品标签单_审核', N'审核=''0''OR审核=''1''', N'审核=''1''OR审核=''0'''),
    (N'半成品标签明细', N'CK_半成品标签明细_数量', N'数量>=0', NULL),
    (N'半成品标签明细', N'CK_半成品标签明细_预计', N'预计标签数>=0', NULL),
    (N'半成品标签明细', N'CK_半成品标签明细_实需', N'实需标签数>=0', NULL);

IF EXISTS (
    SELECT 1
    FROM @必需检查 AS [e]
    LEFT JOIN sys.check_constraints AS [c]
      ON [c].[parent_object_id] = OBJECT_ID(QUOTENAME([e].[表名]))
     AND [c].[name] COLLATE DATABASE_DEFAULT = [e].[约束名]
    OUTER APPLY (
        SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE([c].[definition], N''), N' ', N''), N'(', N''), N')', N''), N'[', N''), N']', N'') AS [规范定义]
    ) AS [n]
    WHERE [c].[object_id] IS NULL OR [c].[is_disabled] = 1 OR [c].[is_not_trusted] = 1
       OR ([n].[规范定义] <> [e].[规范定义一] AND ([e].[规范定义二] IS NULL OR [n].[规范定义] <> [e].[规范定义二]))
)
    THROW 51013, N'半成品标签单已有表的检查约束不符合部署契约', 1;

DECLARE @必需索引列 TABLE (
    [表名] sysname NOT NULL,
    [索引名] sysname NOT NULL,
    [键序] tinyint NOT NULL,
    [列名] sysname NOT NULL
);

INSERT INTO @必需索引列 VALUES
    (N'半成品标签单', N'IX_半成品标签单_日期_ID', 1, N'日期'),
    (N'半成品标签单', N'IX_半成品标签单_日期_ID', 2, N'ID'),
    (N'半成品标签明细', N'IX_半成品标签明细_配件编号', 1, N'配件编号');

IF EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT [表名], [索引名] FROM @必需索引列) AS [e]
    LEFT JOIN sys.indexes AS [i]
      ON [i].[object_id] = OBJECT_ID(QUOTENAME([e].[表名]))
     AND [i].[name] COLLATE DATABASE_DEFAULT = [e].[索引名]
    WHERE [i].[index_id] IS NULL OR [i].[is_unique] = 1 OR [i].[is_disabled] = 1 OR [i].[is_hypothetical] = 1 OR [i].[has_filter] = 1 OR [i].[type] <> 2
       OR EXISTS (
           SELECT [ic].[key_ordinal], [c].[name] COLLATE DATABASE_DEFAULT
           FROM sys.index_columns AS [ic]
           INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
           WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] > 0
           EXCEPT
           SELECT [x].[键序], [x].[列名] FROM @必需索引列 AS [x] WHERE [x].[表名] = [e].[表名] AND [x].[索引名] = [e].[索引名]
       )
       OR EXISTS (
           SELECT [x].[键序], [x].[列名] FROM @必需索引列 AS [x] WHERE [x].[表名] = [e].[表名] AND [x].[索引名] = [e].[索引名]
           EXCEPT
           SELECT [ic].[key_ordinal], [c].[name] COLLATE DATABASE_DEFAULT
           FROM sys.index_columns AS [ic]
           INNER JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
           WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[key_ordinal] > 0
       )
       OR EXISTS (SELECT 1 FROM sys.index_columns AS [ic] WHERE [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id] AND [ic].[is_included_column] = 1)
)
    THROW 51014, N'半成品标签单已有表的索引不符合部署契约', 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
