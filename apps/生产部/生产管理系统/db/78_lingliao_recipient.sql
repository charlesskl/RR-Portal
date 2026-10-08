-- 领料单加 接受人：开单时选择接收人(职称必须为 仓管 或 PMC)，经理审核完后消息只发给该接受人。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[领料单]') AND name=N'接受人')
    ALTER TABLE [领料单] ADD [接受人] nvarchar(40) NULL;
