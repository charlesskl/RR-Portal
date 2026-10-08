-- 塑胶原料资料(基本设置·树脂原料主数据)。EF 不迁移·幂等。
IF OBJECT_ID(N'[塑胶原料资料]', N'U') IS NULL
CREATE TABLE [塑胶原料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(40) NULL,
    [物料编号] nvarchar(40) NULL,
    [物料名称] nvarchar(80) NULL,
    [规格] nvarchar(60) NULL,
    [颜色] nvarchar(30) NULL,
    [单位] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [商品名称] nvarchar(80) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [起订量] decimal(18,4) NULL,
    [安全库存] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [款号] nvarchar(40) NULL,
    [货币] nvarchar(20) NULL,
    [产地] nvarchar(60) NULL,
    [每包重量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
