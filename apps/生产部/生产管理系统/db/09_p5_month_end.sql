-- P5 月结：扩展结存快照表支持「口径(成品/半成品)」与半成品物料维度。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'结存快照表', N'口径') IS NULL
    ALTER TABLE [结存快照表] ADD [口径] nvarchar(8) NOT NULL DEFAULT N'成品';
IF COL_LENGTH(N'结存快照表', N'物料编号') IS NULL
    ALTER TABLE [结存快照表] ADD [物料编号] nvarchar(30) NULL;
IF COL_LENGTH(N'结存快照表', N'物料名称') IS NULL
    ALTER TABLE [结存快照表] ADD [物料名称] nvarchar(40) NULL;
IF COL_LENGTH(N'结存快照表', N'规格') IS NULL
    ALTER TABLE [结存快照表] ADD [规格] nvarchar(40) NULL;
IF COL_LENGTH(N'结存快照表', N'单位') IS NULL
    ALTER TABLE [结存快照表] ADD [单位] nvarchar(10) NULL;

-- 重建唯一索引：纳入 口径 + 物料编号。成品行靠款号维度唯一、半成品行靠物料编号+颜色唯一。表当前为空，重建安全。
-- 先删索引（其引用 款号 列），方可放开 款号 可空。
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_结存快照_维度')
    DROP INDEX UX_结存快照_维度 ON [结存快照表];

-- 半成品行无款号维度（设计：半成品行 款号/色号/尺码=NULL，靠 物料编号+颜色 区分）。
-- 原 P0 表 款号 为 NOT NULL，须放开为可空，否则半成品快照无法写入。幂等。
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'结存快照表') AND name=N'款号' AND is_nullable=0)
    ALTER TABLE [结存快照表] ALTER COLUMN [款号] nvarchar(30) NULL;

CREATE UNIQUE INDEX UX_结存快照_维度 ON [结存快照表]
    ([年月],[仓库],[口径],[款号],[色号],[颜色],[尺码],[物料编号]);
