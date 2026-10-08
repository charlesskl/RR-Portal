-- 塑胶模块:工模表(塑胶仓库·工模主数据)。EF 不迁移·幂等。
-- 主键沿用主数据约定 ID IDENTITY;说明书"工模编号为主键"以唯一索引落实(配合 MasterCrud 泛型按 ID 增删改)。
IF OBJECT_ID(N'[工模表]', N'U') IS NULL
CREATE TABLE [工模表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [工模编号] nvarchar(30) NOT NULL,
    [工模名称] nvarchar(80) NULL,
    [颜色] nvarchar(40) NULL,        -- 格式"颜色/PANTONE"，如 绿色/7481C
    [色粉号] nvarchar(30) NULL,
    [整啤模腔数] decimal(18,4) NULL,
    [水口比例] decimal(18,4) NULL,
    [模具日产量] decimal(18,4) NULL,
    [整啤毛重] decimal(18,4) NULL,
    [整啤净重] decimal(18,4) NULL,
    [啤机机型] nvarchar(30) NULL,
    [啤机价钱] decimal(18,4) NULL,
    [胶件啤工价] decimal(18,4) NULL,
    [用料名称] nvarchar(40) NULL,
    [胶料单价] decimal(18,4) NULL,
    [原胶料单价] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_工模表_工模编号' AND object_id = OBJECT_ID(N'[工模表]'))
    CREATE UNIQUE INDEX [UX_工模表_工模编号] ON [工模表]([工模编号]);
