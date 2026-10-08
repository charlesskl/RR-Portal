-- 采购退仓单复用采购入仓的订单选择器：给 采购退仓明细单 加 订单单号 列以留痕(幂等)。
SET XACT_ABORT ON;
IF COL_LENGTH(N'采购退仓明细单', N'订单单号') IS NULL
    ALTER TABLE [采购退仓明细单] ADD [订单单号] nvarchar(20) NULL;
