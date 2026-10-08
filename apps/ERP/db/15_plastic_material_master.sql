-- 塑胶模块 P0 地基:塑胶物料资料主数据表(镜像 物料资料 + 仓位号)
IF OBJECT_ID(N'[塑胶物料资料]', N'U') IS NULL
CREATE TABLE [塑胶物料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [货币] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL
);
