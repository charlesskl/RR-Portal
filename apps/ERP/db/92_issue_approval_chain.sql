-- 领料/出库单三级流转:开单 → 主管审核 → 经理审核 → 审核(posting 审核='1')。
-- 白件领料单/半成品领料单/原料出库单 补 6 列(领料单/塑胶领料单已有);列型对齐 领料单 现有列。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[白件领料单]') AND name=N'主管审核')
    ALTER TABLE [白件领料单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[白件领料单]') AND name=N'经理审核')
    ALTER TABLE [白件领料单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[半成品领料单]') AND name=N'主管审核')
    ALTER TABLE [半成品领料单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[半成品领料单]') AND name=N'经理审核')
    ALTER TABLE [半成品领料单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[原料出库单]') AND name=N'主管审核')
    ALTER TABLE [原料出库单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[原料出库单]') AND name=N'经理审核')
    ALTER TABLE [原料出库单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
GO
