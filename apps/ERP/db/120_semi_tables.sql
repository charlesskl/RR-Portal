-- 120_semi_tables.sql — 半成品相关系列表收编。EF 不迁移·幂等（可重复执行，已存在则跳过）。
-- 背景：以下 9 张表原由非编号 migrate_*.sql 创建，run-db.ps1 按编号自动枚举不会跑 migrate_*，
--       全新建库会缺这些表，故收编为编号迁移；原 migrate_* 文件保留不动。
-- 来源（表结构逐列照抄，含索引/约束/升级块；migrate 脚本里的部署契约 THROW 校验属一次性断言，未收编）：
--   半成品共用物料设置                  ← migrate_semi_finished_common_materials.sql（含 UX_产品货号 / IX_共用审核）
--   半成品标签单 / 半成品标签明细        ← migrate_semi_finished_label_orders.sql（含 IX_日期_ID / IX_配件编号）
--   半成品退仓单 / 半成品退仓明细单      ← migrate_semi_warehouse_returns.sql（含旧结构升级块）
--   半成品退库单 / 半成品退库明细单      ← migrate_semi_stock_returns.sql
--   半成品报废单 / 半成品报废明细单      ← migrate_semi_scraps.sql
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- ===== 半成品共用物料设置（← migrate_semi_finished_common_materials.sql） =====
IF OBJECT_ID(N'[半成品共用物料设置]', N'U') IS NULL
BEGIN
  CREATE TABLE [半成品共用物料设置](
    [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [产品货号] nvarchar(100) NOT NULL,
    [产品装配名称] nvarchar(200) NULL,
    [配件编号] nvarchar(100) NULL,
    [共用物料编号] nvarchar(100) NULL,
    [装配方式] nvarchar(100) NULL,
    [类别] nvarchar(50) NULL,
    [库存单价HK] decimal(18,4) NULL,
    [其他成本HK] decimal(18,4) NULL,
    [需求用量] decimal(18,4) NULL,
    [单位] nvarchar(30) NULL,
    [半成品计算库存] bit NOT NULL CONSTRAINT [DF_半成品共用物料设置_计算库存] DEFAULT(0),
    [备注内容] nvarchar(500) NULL,
    [调整审核] bit NOT NULL CONSTRAINT [DF_半成品共用物料设置_审核] DEFAULT(0),
    [审核人] nvarchar(50) NULL,
    [审核时间] datetime2 NULL,
    [更新人] nvarchar(50) NULL,
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_半成品共用物料设置_更新时间] DEFAULT(SYSDATETIME())
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_半成品共用物料设置_产品货号' AND object_id = OBJECT_ID(N'[半成品共用物料设置]'))
  CREATE UNIQUE INDEX [UX_半成品共用物料设置_产品货号] ON [半成品共用物料设置]([产品货号]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_半成品共用物料设置_共用审核' AND object_id = OBJECT_ID(N'[半成品共用物料设置]'))
  CREATE INDEX [IX_半成品共用物料设置_共用审核] ON [半成品共用物料设置]([共用物料编号],[调整审核]);

-- ===== 半成品标签单 / 半成品标签明细（← migrate_semi_finished_label_orders.sql） =====
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

-- ===== 半成品退仓单 / 半成品退仓明细单（← migrate_semi_warehouse_returns.sql） =====
IF OBJECT_ID(N'[半成品退仓单]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品退仓单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退仓单] PRIMARY KEY,
        [单号] nvarchar(40) NOT NULL CONSTRAINT [UQ_半成品退仓单_单号] UNIQUE,
        [入仓单号] nvarchar(40) NOT NULL,
        [日期] date NOT NULL,
        [供应商编号] nvarchar(80) NULL,
        [供应商名称] nvarchar(200) NULL,
        [仓库] nvarchar(80) NOT NULL,
        [数量] decimal(18,4) NOT NULL,
        [金额] decimal(18,4) NOT NULL,
        [操作员] nvarchar(80) NOT NULL,
        [审核] char(1) NOT NULL CONSTRAINT [DF_半成品退仓单_审核] DEFAULT ('0'),
        [审核人] nvarchar(80) NULL,
        [审核日期] datetime2 NULL,
        [备注] nvarchar(500) NULL,
        CONSTRAINT [CK_半成品退仓单_审核] CHECK ([审核] IN ('0','1'))
    );
END;

IF OBJECT_ID(N'[半成品退仓明细单]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品退仓明细单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退仓明细单] PRIMARY KEY,
        [单号] nvarchar(40) NOT NULL,
        [入仓单号] nvarchar(40) NOT NULL,
        [入仓明细ID] bigint NULL,
        [日期] date NOT NULL,
        [供应商编号] nvarchar(80) NULL,
        [供应商名称] nvarchar(200) NULL,
        [仓库] nvarchar(80) NOT NULL,
        [订单单号] nvarchar(80) NULL,
        [客户] nvarchar(160) NULL,
        [生产单号] nvarchar(80) NULL,
        [货号] nvarchar(120) NULL,
        [名称] nvarchar(240) NULL,
        [物料编号] nvarchar(120) NULL,
        [物料名称] nvarchar(240) NULL,
        [规格] nvarchar(160) NULL,
        [颜色] nvarchar(80) NULL,
        [单位] nvarchar(40) NULL,
        [数量] decimal(18,4) NOT NULL,
        [单价] decimal(18,4) NOT NULL,
        [金额] decimal(18,4) NOT NULL,
        [备注] nvarchar(500) NULL,
        CONSTRAINT [FK_半成品退仓明细单_单号] FOREIGN KEY ([单号]) REFERENCES [半成品退仓单]([单号]) ON DELETE CASCADE,
        CONSTRAINT [UQ_半成品退仓明细单_物料] UNIQUE ([单号], [物料编号]),
        CONSTRAINT [CK_半成品退仓明细单_数量] CHECK ([数量] > 0)
    );
END;

-- 升级：旧结构（入仓明细ID NOT NULL + UQ_来源）迁到自由选产品结构（幂等守卫，新库/已迁移库均不触发）
IF OBJECT_ID(N'[半成品退仓明细单]', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_半成品退仓明细单_来源')
        ALTER TABLE [半成品退仓明细单] DROP CONSTRAINT [UQ_半成品退仓明细单_来源];
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_半成品退仓明细单_入仓明细ID' AND object_id = OBJECT_ID(N'[半成品退仓明细单]'))
        DROP INDEX [IX_半成品退仓明细单_入仓明细ID] ON [半成品退仓明细单];
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[半成品退仓明细单]') AND name = N'入仓明细ID' AND is_nullable = 0)
        ALTER TABLE [半成品退仓明细单] ALTER COLUMN [入仓明细ID] bigint NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_半成品退仓明细单_物料')
        ALTER TABLE [半成品退仓明细单] ADD CONSTRAINT [UQ_半成品退仓明细单_物料] UNIQUE ([单号], [物料编号]);
END;

-- ===== 半成品退库单 / 半成品退库明细单（← migrate_semi_stock_returns.sql） =====
IF OBJECT_ID(N'[半成品退库单]', N'U') IS NULL
BEGIN
CREATE TABLE [半成品退库单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退库单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL CONSTRAINT [UQ_半成品退库单_单号] UNIQUE,
    [日期] date NOT NULL,
    [部门] nvarchar(80) NULL,
    [退料人] nvarchar(80) NULL,
    [仓库] nvarchar(80) NOT NULL,
    [数量] decimal(18,4) NOT NULL,
    [金额] decimal(18,4) NOT NULL,
    [操作员] nvarchar(80) NULL,
    [审核] char(1) NOT NULL CONSTRAINT [DF_半成品退库单_审核] DEFAULT ('0'),
    [审核人] nvarchar(80) NULL,
    [审核日期] datetime2 NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [CK_半成品退库单_审核] CHECK ([审核] IN ('0','1'))
);
END;

IF OBJECT_ID(N'[半成品退库明细单]', N'U') IS NULL
BEGIN
CREATE TABLE [半成品退库明细单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退库明细单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL,
    [日期] date NULL,
    [仓库] nvarchar(80) NULL,
    [订单单号] nvarchar(80) NULL,
    [客户] nvarchar(200) NULL,
    [生产单号] nvarchar(80) NULL,
    [货号] nvarchar(200) NULL,
    [名称] nvarchar(200) NULL,
    [物料编号] nvarchar(80) NOT NULL,
    [物料名称] nvarchar(200) NULL,
    [规格] nvarchar(200) NULL,
    [颜色] nvarchar(80) NULL,
    [单位] nvarchar(40) NULL,
    [数量] decimal(18,4) NOT NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [UQ_半成品退库明细单_物料] UNIQUE ([单号],[物料编号])
);
END;

-- ===== 半成品报废单 / 半成品报废明细单（← migrate_semi_scraps.sql） =====
IF OBJECT_ID(N'[半成品报废单]', N'U') IS NULL
BEGIN
CREATE TABLE [半成品报废单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品报废单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL CONSTRAINT [UQ_半成品报废单_单号] UNIQUE,
    [日期] date NOT NULL,
    [部门] nvarchar(80) NULL,
    [报废人] nvarchar(80) NULL,
    [仓库] nvarchar(80) NOT NULL,
    [数量] decimal(18,4) NOT NULL,
    [金额] decimal(18,4) NOT NULL,
    [操作员] nvarchar(80) NULL,
    [审核] char(1) NOT NULL CONSTRAINT [DF_半成品报废单_审核] DEFAULT ('0'),
    [审核人] nvarchar(80) NULL,
    [审核日期] datetime2 NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [CK_半成品报废单_审核] CHECK ([审核] IN ('0','1'))
);
END;

IF OBJECT_ID(N'[半成品报废明细单]', N'U') IS NULL
BEGIN
CREATE TABLE [半成品报废明细单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品报废明细单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL,
    [日期] date NULL,
    [仓库] nvarchar(80) NULL,
    [订单单号] nvarchar(80) NULL,
    [客户] nvarchar(200) NULL,
    [生产单号] nvarchar(80) NULL,
    [货号] nvarchar(200) NULL,
    [名称] nvarchar(200) NULL,
    [物料编号] nvarchar(80) NOT NULL,
    [物料名称] nvarchar(200) NULL,
    [规格] nvarchar(200) NULL,
    [颜色] nvarchar(80) NULL,
    [单位] nvarchar(40) NULL,
    [数量] decimal(18,4) NOT NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [UQ_半成品报废明细单_物料] UNIQUE ([单号],[物料编号])
);
END;

COMMIT TRANSACTION;
