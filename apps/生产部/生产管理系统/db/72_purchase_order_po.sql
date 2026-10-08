-- 采购订单(来料)单头加 PO号 列:排期下单时把客户 PO号 自动填入单头(对齐塑胶采购订单.编号)。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'采购订单', N'PO号') IS NULL
    ALTER TABLE [采购订单] ADD [PO号] nvarchar(40) NULL;
