-- 领料单三级流转：装配部开单 → 部门主管审核 → 部门经理审核 → 来料仓出库。
-- 单据记录两级审核人/日期，来料仓看到的单上显示 某主管/某经理 已审核。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[领料单]') AND name=N'主管审核')
    ALTER TABLE [领料单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[领料单]') AND name=N'经理审核')
    ALTER TABLE [领料单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
