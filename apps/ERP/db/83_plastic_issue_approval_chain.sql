-- 塑胶领料单三级流转：领料部门开单 → 部门主管审核 → 部门经理审核 → 塑胶仓出库(审核='1')。
-- 单据记录两级审核人/日期，塑胶仓看到的单上显示 某主管/某经理 已审核。幂等。对齐 db/76 领料单写法。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶领料单]') AND name=N'主管审核')
    ALTER TABLE [塑胶领料单] ADD [主管审核] nvarchar(4) NULL, [主管审核人] nvarchar(40) NULL, [主管审核日期] datetime NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶领料单]') AND name=N'经理审核')
    ALTER TABLE [塑胶领料单] ADD [经理审核] nvarchar(4) NULL, [经理审核人] nvarchar(40) NULL, [经理审核日期] datetime NULL;
