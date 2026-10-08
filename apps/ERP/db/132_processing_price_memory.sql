-- 委托加工单 行级单价记忆:保存单据时按货号记录最近单价(后写覆盖先写),
-- 下次选半成品/选物料入行自动带出,免重复手输。EF 不迁移·幂等。

IF OBJECT_ID(N'[加工单价记忆]', N'U') IS NULL
CREATE TABLE [加工单价记忆] (
    [货号] nvarchar(60) NOT NULL PRIMARY KEY,
    [单价] decimal(18,4) NOT NULL,
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_加工单价记忆_更新时间] DEFAULT SYSDATETIME(),
    [操作员] nvarchar(20) NULL
);
