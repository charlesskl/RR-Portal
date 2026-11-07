-- P113 cloud-only minimal prerequisites, applied after 173 and 174 in the
-- release's explicit transaction. Do not replay historical migrations/seeds.
-- Extracts only raw-workflow schema needed from local 156/162/163 and the raw-calculation column of 164.
-- Existing business values, snapshots, accounts and permissions are unchanged.
-- New columns are nullable without defaults; new tables receive no seed rows.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.塑胶采购订单',N'U') IS NULL
 OR OBJECT_ID(N'dbo.塑胶采购订单明细',N'U') IS NULL
 OR OBJECT_ID(N'dbo.原料盘点明细单',N'U') IS NULL
 OR OBJECT_ID(N'dbo.sysfileuser',N'U') IS NULL
    THROW 51000,N'P113云端增量缺少既有基础表，停止迁移；不可自动重建或恢复业务库。',1;

-- Header snapshots: a historical NULL remains NULL and retains its old identity.
IF COL_LENGTH(N'dbo.塑胶采购订单',N'原料扣减版本') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单] ADD [原料扣减版本] int NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单',N'原料扣减方式') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单] ADD [原料扣减方式] nvarchar(20) NULL;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE [parent_object_id]=OBJECT_ID(N'dbo.塑胶采购订单') AND [name]=N'CK_塑胶采购订单_原料扣减方式')
    EXEC(N'ALTER TABLE [dbo].[塑胶采购订单] WITH CHECK ADD CONSTRAINT [CK_塑胶采购订单_原料扣减方式]
        CHECK([原料扣减方式] IS NULL OR [原料扣减方式]=N''领料出库'')');

-- Saved raw components and molding group facts. Never infer old values.
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'原料配比错误') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [原料配比错误] nvarchar(300) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'原料扣减组分数') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [原料扣减组分数] int NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'原料组号') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [原料组号] int NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'原料组主行') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [原料组主行] bit NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'原料组成员数') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [原料组成员数] int NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'核算套数') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [核算套数] decimal(20,4) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'核算整啤净重') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [核算整啤净重] decimal(20,4) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'核算啤数') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [核算啤数] decimal(28,0) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'核算模具编号') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [核算模具编号] nvarchar(30) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'核算模具名称') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [核算模具名称] nvarchar(80) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'原料组净重KG') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [原料组净重KG] decimal(18,4) NULL;
IF COL_LENGTH(N'dbo.塑胶采购订单明细',N'核算出模数') IS NULL
    ALTER TABLE [dbo].[塑胶采购订单明细] ADD [核算出模数] decimal(20,4) NULL;

IF OBJECT_ID(N'dbo.塑胶原料配方',N'U') IS NULL
CREATE TABLE [dbo].[塑胶原料配方](
    [原料ID] bigint NOT NULL CONSTRAINT [PK_塑胶原料配方] PRIMARY KEY,
    [操作员] nvarchar(50) NOT NULL,
    [修改日期] datetime2 NOT NULL
);
IF OBJECT_ID(N'dbo.塑胶原料配方明细',N'U') IS NULL
CREATE TABLE [dbo].[塑胶原料配方明细](
    [配方原料ID] bigint NOT NULL,
    [原料ID] bigint NOT NULL,
    [比例] decimal(18,4) NOT NULL,
    [库存单位] nvarchar(10) NOT NULL,
    [每库存单位KG] decimal(18,8) NOT NULL,
    CONSTRAINT [PK_塑胶原料配方明细] PRIMARY KEY([配方原料ID],[原料ID]),
    CONSTRAINT [FK_塑胶原料配方明细_配方] FOREIGN KEY([配方原料ID]) REFERENCES [dbo].[塑胶原料配方]([原料ID]),
    CONSTRAINT [CK_塑胶原料配方明细_正比例] CHECK([比例]>0 AND [每库存单位KG]>0)
);
IF OBJECT_ID(N'dbo.塑胶采购原料用量',N'U') IS NULL
CREATE TABLE [dbo].[塑胶采购原料用量](
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_塑胶采购原料用量] PRIMARY KEY,
    [采购单号] nvarchar(30) NOT NULL,
    [采购明细ID] bigint NOT NULL,
    [原料ID] bigint NOT NULL,
    [原料编号] nvarchar(40) NOT NULL,
    [原料名称] nvarchar(80) NOT NULL,
    [比例] decimal(18,4) NOT NULL,
    [总比例] decimal(18,4) NOT NULL,
    [用量KG] decimal(18,4) NOT NULL,
    [库存数量] decimal(18,8) NOT NULL,
    [库存单位] nvarchar(10) NOT NULL,
    [每库存单位KG] decimal(18,8) NOT NULL,
    CONSTRAINT [UQ_塑胶采购原料用量_来源] UNIQUE([采购明细ID],[原料ID]),
    CONSTRAINT [CK_塑胶采购原料用量_有效数量] CHECK([比例]>0 AND [总比例]>0 AND [用量KG]>=0 AND [库存数量]>=0 AND [每库存单位KG]>0)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE [object_id]=OBJECT_ID(N'dbo.塑胶采购原料用量') AND [name]=N'IX_塑胶采购原料用量_采购')
    CREATE INDEX [IX_塑胶采购原料用量_采购] ON [dbo].[塑胶采购原料用量]([采购单号],[原料编号]) INCLUDE([用量KG],[库存数量]);
IF OBJECT_ID(N'dbo.原料自动扣料期初',N'U') IS NULL
CREATE TABLE [dbo].[原料自动扣料期初](
    [原料编号] nvarchar(80) NOT NULL CONSTRAINT [PK_原料自动扣料期初] PRIMARY KEY,
    [期初数量] decimal(18,8) NOT NULL,
    [库存单位] nvarchar(10) NOT NULL,
    [每库存单位KG] decimal(18,8) NOT NULL,
    [启用日期] datetime2 NOT NULL
);

IF COL_LENGTH(N'dbo.原料盘点明细单',N'原料台账盘点') IS NULL
    ALTER TABLE [dbo].[原料盘点明细单] ADD [原料台账盘点] bit NULL;
-- Unlike local 156's decimal(18,8), this target retains all 14 integer digits
-- of the cloud baseline decimal(18,4). Unexpected wider schemas require review.
IF EXISTS(
    SELECT 1 FROM (VALUES(N'系统数量'),(N'盘点数量'),(N'盈亏数量')) AS e([name])
    LEFT JOIN sys.columns AS c ON c.[object_id]=OBJECT_ID(N'dbo.原料盘点明细单') AND c.[name]=e.[name]
    WHERE c.[column_id] IS NULL OR TYPE_NAME(c.[system_type_id]) NOT IN(N'decimal',N'numeric')
       OR c.[precision]-c.[scale]>20 OR c.[scale]>8 OR c.[is_nullable]<>1 OR c.[is_computed]<>0)
    THROW 51000,N'原料盘点数量列并非可无损扩展的既有decimal结构；请人工核对，禁止截断旧值。',1;
IF EXISTS(SELECT 1 FROM sys.columns WHERE [object_id]=OBJECT_ID(N'dbo.原料盘点明细单') AND [name]=N'系统数量' AND ([precision]<>28 OR [scale]<>8))
    ALTER TABLE [dbo].[原料盘点明细单] ALTER COLUMN [系统数量] decimal(28,8) NULL;
IF EXISTS(SELECT 1 FROM sys.columns WHERE [object_id]=OBJECT_ID(N'dbo.原料盘点明细单') AND [name]=N'盘点数量' AND ([precision]<>28 OR [scale]<>8))
    ALTER TABLE [dbo].[原料盘点明细单] ALTER COLUMN [盘点数量] decimal(28,8) NULL;
IF EXISTS(SELECT 1 FROM sys.columns WHERE [object_id]=OBJECT_ID(N'dbo.原料盘点明细单') AND [name]=N'盈亏数量' AND ([precision]<>28 OR [scale]<>8))
    ALTER TABLE [dbo].[原料盘点明细单] ALTER COLUMN [盈亏数量] decimal(28,8) NULL;

-- Explicit role bindings apply only to the new raw workflow. No global
-- department catalog, account-role migration or userbqrpower seed is replayed.
IF OBJECT_ID(N'dbo.原料流程岗位绑定',N'U') IS NULL
CREATE TABLE [dbo].[原料流程岗位绑定](
    [用户ID] bigint NOT NULL CONSTRAINT [PK_原料流程岗位绑定] PRIMARY KEY,
    [部门编号] nvarchar(10) NOT NULL,
    [岗位代码] nvarchar(40) NOT NULL,
    [所属仓库] nvarchar(20) NULL,
    [更新人] nvarchar(40) NULL,
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_原料流程岗位绑定_更新时间] DEFAULT(SYSDATETIME()),
    CONSTRAINT [FK_原料流程岗位绑定_账号] FOREIGN KEY([用户ID]) REFERENCES [dbo].[sysfileuser]([ID]),
    CONSTRAINT [CK_原料流程岗位绑定_岗位范围] CHECK(
        DATALENGTH([部门编号])=4 AND DATALENGTH([岗位代码])=LEN([岗位代码])*2 AND
        (([部门编号]=N'06' AND ([岗位代码] COLLATE Latin1_General_100_BIN2=N'06-clerk' OR [岗位代码] COLLATE Latin1_General_100_BIN2=N'06-supervisor' OR [岗位代码] COLLATE Latin1_General_100_BIN2=N'06-manager') AND [所属仓库] IS NULL)
         OR ([部门编号]=N'05' AND [岗位代码] COLLATE Latin1_General_100_BIN2=N'05-manager' AND [所属仓库] IS NULL)
         OR ([部门编号]=N'05' AND [岗位代码] COLLATE Latin1_General_100_BIN2=N'05-warehouse' AND [所属仓库] IS NOT NULL AND [所属仓库]=N'原料仓' AND DATALENGTH([所属仓库])=6)))
);

-- A same-name pre-existing column is not permission to reinterpret its type.
-- This validation is read-only; deployment rolls the entire scoped transaction
-- back if a schema drift is detected. Extra existing columns are left intact.
IF EXISTS(
    SELECT 1 FROM (VALUES
      (N'塑胶采购订单',N'原料扣减版本',N'int',4,10,0,1,0),
      (N'塑胶采购订单',N'原料扣减方式',N'nvarchar',40,0,0,1,0),
      (N'塑胶采购订单明细',N'原料配比错误',N'nvarchar',600,0,0,1,0),
      (N'塑胶采购订单明细',N'原料扣减组分数',N'int',4,10,0,1,0),
      (N'塑胶采购订单明细',N'原料组号',N'int',4,10,0,1,0),
      (N'塑胶采购订单明细',N'原料组主行',N'bit',1,1,0,1,0),
      (N'塑胶采购订单明细',N'原料组成员数',N'int',4,10,0,1,0),
      (N'塑胶采购订单明细',N'核算套数',N'decimal',13,20,4,1,0),
      (N'塑胶采购订单明细',N'核算整啤净重',N'decimal',13,20,4,1,0),
      (N'塑胶采购订单明细',N'核算啤数',N'decimal',13,28,0,1,0),
      (N'塑胶采购订单明细',N'核算模具编号',N'nvarchar',60,0,0,1,0),
      (N'塑胶采购订单明细',N'核算模具名称',N'nvarchar',160,0,0,1,0),
      (N'塑胶采购订单明细',N'原料组净重KG',N'decimal',9,18,4,1,0),
      (N'塑胶采购订单明细',N'核算出模数',N'decimal',13,20,4,1,0),
      (N'原料盘点明细单',N'原料台账盘点',N'bit',1,1,0,1,0),
      (N'原料盘点明细单',N'系统数量',N'decimal',13,28,8,1,0),
      (N'原料盘点明细单',N'盘点数量',N'decimal',13,28,8,1,0),
      (N'原料盘点明细单',N'盈亏数量',N'decimal',13,28,8,1,0),
      (N'塑胶原料配方',N'原料ID',N'bigint',8,19,0,0,0),
      (N'塑胶原料配方',N'操作员',N'nvarchar',100,0,0,0,0),
      (N'塑胶原料配方',N'修改日期',N'datetime2',8,27,7,0,0),
      (N'塑胶原料配方明细',N'配方原料ID',N'bigint',8,19,0,0,0),
      (N'塑胶原料配方明细',N'原料ID',N'bigint',8,19,0,0,0),
      (N'塑胶原料配方明细',N'比例',N'decimal',9,18,4,0,0),
      (N'塑胶原料配方明细',N'库存单位',N'nvarchar',20,0,0,0,0),
      (N'塑胶原料配方明细',N'每库存单位KG',N'decimal',9,18,8,0,0),
      (N'塑胶采购原料用量',N'ID',N'bigint',8,19,0,0,1),
      (N'塑胶采购原料用量',N'采购单号',N'nvarchar',60,0,0,0,0),
      (N'塑胶采购原料用量',N'采购明细ID',N'bigint',8,19,0,0,0),
      (N'塑胶采购原料用量',N'原料ID',N'bigint',8,19,0,0,0),
      (N'塑胶采购原料用量',N'原料编号',N'nvarchar',80,0,0,0,0),
      (N'塑胶采购原料用量',N'原料名称',N'nvarchar',160,0,0,0,0),
      (N'塑胶采购原料用量',N'比例',N'decimal',9,18,4,0,0),
      (N'塑胶采购原料用量',N'总比例',N'decimal',9,18,4,0,0),
      (N'塑胶采购原料用量',N'用量KG',N'decimal',9,18,4,0,0),
      (N'塑胶采购原料用量',N'库存数量',N'decimal',9,18,8,0,0),
      (N'塑胶采购原料用量',N'库存单位',N'nvarchar',20,0,0,0,0),
      (N'塑胶采购原料用量',N'每库存单位KG',N'decimal',9,18,8,0,0),
      (N'原料自动扣料期初',N'原料编号',N'nvarchar',160,0,0,0,0),
      (N'原料自动扣料期初',N'期初数量',N'decimal',9,18,8,0,0),
      (N'原料自动扣料期初',N'库存单位',N'nvarchar',20,0,0,0,0),
      (N'原料自动扣料期初',N'每库存单位KG',N'decimal',9,18,8,0,0),
      (N'原料自动扣料期初',N'启用日期',N'datetime2',8,27,7,0,0),
      (N'原料流程岗位绑定',N'用户ID',N'bigint',8,19,0,0,0),
      (N'原料流程岗位绑定',N'部门编号',N'nvarchar',20,0,0,0,0),
      (N'原料流程岗位绑定',N'岗位代码',N'nvarchar',80,0,0,0,0),
      (N'原料流程岗位绑定',N'所属仓库',N'nvarchar',40,0,0,1,0),
      (N'原料流程岗位绑定',N'更新人',N'nvarchar',80,0,0,1,0),
      (N'原料流程岗位绑定',N'更新时间',N'datetime2',8,27,7,0,0)
    ) AS e([table],[column],[type],[bytes],[precision],[scale],[nullable],[identity])
    LEFT JOIN sys.columns AS c ON c.[object_id]=OBJECT_ID(N'dbo.'+QUOTENAME(e.[table]),N'U') AND c.[name]=e.[column]
    WHERE c.[column_id] IS NULL OR TYPE_NAME(c.[user_type_id])<>e.[type] OR c.[max_length]<>e.[bytes]
       OR c.[precision]<>e.[precision] OR c.[scale]<>e.[scale] OR c.[is_nullable]<>e.[nullable]
       OR c.[is_identity]<>e.[identity] OR c.[is_computed]<>0)
    THROW 51000,N'P113云端增量发现既有同名字段定义不一致；停止迁移，不猜测或重写旧数据。',1;
