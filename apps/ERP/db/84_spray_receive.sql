-- 喷油部接收流程：塑胶采购订单(供应商含「喷油」)审核后,喷油部在「喷油加工订单-已下喷油订单」页签接收。
-- 接收只标记单头,不动库存/审核位。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶采购订单]') AND name=N'喷油接收')
    ALTER TABLE [塑胶采购订单] ADD [喷油接收] nvarchar(4) NULL, [喷油接收人] nvarchar(40) NULL, [喷油接收时间] datetime NULL;
GO
