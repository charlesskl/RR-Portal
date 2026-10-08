-- 仓库位置设置（基本设置组）：仓库/仓位主数据。EF 不迁移·幂等。
-- 物料资料/塑胶物料资料/塑胶原料资料的 [仓位号] 字段引用本表 [编号]。

IF OBJECT_ID(N'[仓库位置]', N'U') IS NULL
CREATE TABLE [仓库位置] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [编号] nvarchar(20) NOT NULL,
    [名称] nvarchar(60) NULL,
    [备注] nvarchar(200) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_仓库位置_编号' AND object_id = OBJECT_ID(N'[仓库位置]'))
CREATE UNIQUE INDEX [UX_仓库位置_编号] ON [仓库位置]([编号]);
