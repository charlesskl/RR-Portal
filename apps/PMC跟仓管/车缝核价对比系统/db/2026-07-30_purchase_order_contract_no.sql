/* 外发订单明细增加合同号；可重复执行。 */
IF COL_LENGTH(N'dbo.purchase_order_line', N'contract_no') IS NULL
BEGIN
    ALTER TABLE dbo.purchase_order_line
        ADD contract_no NVARCHAR(100) NULL;
END
GO
