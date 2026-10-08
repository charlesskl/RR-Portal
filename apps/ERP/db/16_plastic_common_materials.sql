-- 塑胶模块 P1:塑胶共用物料表(按塑胶货号的塑胶注塑BOM·塑胶物料单带出源)
IF OBJECT_ID(N'[塑胶共用物料表]', N'U') IS NULL
CREATE TABLE [塑胶共用物料表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [客户] nvarchar(50) NULL,
    [塑胶货号] nvarchar(40) NULL,
    [工模编号] nvarchar(30) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [色粉号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [加工内容] nvarchar(50) NULL,
    [加工单价] decimal(18,4) NULL,
    [整啤净重] decimal(18,4) NULL,
    [原胶件单净重] decimal(18,4) NULL,
    [整啤模腔数] decimal(18,4) NULL,
    [套数] decimal(18,4) NULL,
    [用量] decimal(18,4) NULL,
    [物料编号] nvarchar(20) NULL,
    [共用原料编号] nvarchar(20) NULL,
    [调整审核] nvarchar(5) NULL,
    [备注内容] nvarchar(200) NULL,
    [工模表备注] nvarchar(200) NULL
);
