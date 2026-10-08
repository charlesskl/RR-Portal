-- 装配三项规则（批次3）：出厂价/装彩盒单价字段 + 本厂报价行约束。EF 不迁移·幂等。

-- 自包含建表：装配物料报价 原由非编号脚本 migrate_semi_finished_common_materials.sql 创建，
-- run-db.ps1 按编号自动枚举不会跑 migrate_*，故此处补齐（已存在则跳过；定义与 migrate 脚本一致）。
IF OBJECT_ID(N'[装配物料报价]', N'U') IS NULL
BEGIN
  CREATE TABLE [装配物料报价](
    [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [产品货号] nvarchar(100) NOT NULL,
    [物料编号] nvarchar(100) NULL,
    [物料名称] nvarchar(200) NULL,
    [合作方类型] nvarchar(20) NOT NULL,
    [合作方编号] nvarchar(50) NULL,
    [合作方名称] nvarchar(200) NULL,
    [报价日期] date NULL,
    [货币] nvarchar(20) NULL,
    [单价] decimal(18,4) NULL,
    [港币价] decimal(18,4) NULL,
    [对比相差] decimal(18,4) NULL,
    [相差比例] decimal(18,4) NULL,
    [是否默认] bit NOT NULL CONSTRAINT [DF_装配物料报价_默认] DEFAULT(0),
    [顺序] int NOT NULL CONSTRAINT [DF_装配物料报价_顺序] DEFAULT(0),
    [备注] nvarchar(500) NULL
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_装配物料报价_产品货号' AND object_id = OBJECT_ID(N'[装配物料报价]'))
  CREATE INDEX [IX_装配物料报价_产品货号] ON [装配物料报价]([产品货号],[顺序],[ID]);

-- 工程BOM（款号主档）单价字段：库存单价HK 自动计算的优先来源。
-- 类别=成品 → 取 [出厂价]；类别为半成品类 → 取 [装彩盒单价]；都为空则按 BOM 明细 Σ(使用数量×物料资料.单价) 兜底。
IF COL_LENGTH(N'[款号总表]', N'出厂价') IS NULL
BEGIN
  ALTER TABLE [款号总表] ADD [出厂价] decimal(18,4) NULL;
END;
IF COL_LENGTH(N'[款号总表]', N'装彩盒单价') IS NULL
BEGIN
  ALTER TABLE [款号总表] ADD [装彩盒单价] decimal(18,4) NULL;
END;

-- 本厂报价行：合作方编号/名称必须为空（不可选加工厂/供应商）。
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_装配物料报价_本厂无合作方')
BEGIN
  ALTER TABLE [装配物料报价] ADD CONSTRAINT [CK_装配物料报价_本厂无合作方]
  CHECK ([合作方类型] <> N'本厂'
         OR (NULLIF(LTRIM(RTRIM(ISNULL([合作方编号], N''))), N'') IS NULL
         AND NULLIF(LTRIM(RTRIM(ISNULL([合作方名称], N''))), N'') IS NULL));
END;

-- 每个款号至多一行本厂（过滤唯一索引；若存量数据已有重复本厂行需先清理再执行）。
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_装配物料报价_本厂' AND object_id = OBJECT_ID(N'[装配物料报价]'))
BEGIN
  CREATE UNIQUE INDEX [UX_装配物料报价_本厂] ON [装配物料报价]([产品货号])
  WHERE [合作方类型] = N'本厂';
END;
