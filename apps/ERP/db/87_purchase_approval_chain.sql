-- 采购订单三级流转:开单 → 主管审核 → 经理审核 → 审核(下发,posting 审核='1')。
-- 覆盖 5 张采购订单表;单据记录两级审核人/日期。幂等。对齐 db/83 塑胶领料单写法。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶采购订单]') AND name=N'主管审核')
    ALTER TABLE [塑胶采购订单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶采购订单]') AND name=N'经理审核')
    ALTER TABLE [塑胶采购订单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[采购订单]') AND name=N'主管审核')
    ALTER TABLE [采购订单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[采购订单]') AND name=N'经理审核')
    ALTER TABLE [采购订单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[原料采购订单]') AND name=N'主管审核')
    ALTER TABLE [原料采购订单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[原料采购订单]') AND name=N'经理审核')
    ALTER TABLE [原料采购订单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[装配加工采购单]') AND name=N'主管审核')
    ALTER TABLE [装配加工采购单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[装配加工采购单]') AND name=N'经理审核')
    ALTER TABLE [装配加工采购单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶加工采购单]') AND name=N'主管审核')
    ALTER TABLE [塑胶加工采购单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶加工采购单]') AND name=N'经理审核')
    ALTER TABLE [塑胶加工采购单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
