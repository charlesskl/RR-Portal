-- 啤机机型啤工表（基本设置组）：啤机机型 + 啤工价主数据。EF 不迁移·幂等。
-- 工模表/塑胶共用物料表的 [啤机机型] 字段引用本表机型，[啤机价钱] 可参考本表 [啤工价]。

IF OBJECT_ID(N'[啤机机型啤工表]', N'U') IS NULL
CREATE TABLE [啤机机型啤工表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [啤机机型] nvarchar(30) NOT NULL,
    [啤工价] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_啤机机型啤工表_机型' AND object_id = OBJECT_ID(N'[啤机机型啤工表]'))
CREATE UNIQUE INDEX [UX_啤机机型啤工表_机型] ON [啤机机型啤工表]([啤机机型]);
