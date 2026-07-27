/* 产品级核价重构：业务颗粒度由“款式×工序”改为“款式”。幂等升级。 */
USE [StitchCostPro];
GO

IF COL_LENGTH(N'dbo.product_quote', N'customer_name') IS NULL
    ALTER TABLE dbo.product_quote ADD customer_name NVARCHAR(120) NULL;
IF COL_LENGTH(N'dbo.product_quote', N'customer_quote_excl') IS NULL
    ALTER TABLE dbo.product_quote ADD customer_quote_excl DECIMAL(14,4) NULL;
IF COL_LENGTH(N'dbo.product_quote', N'dongguan_price_excl') IS NULL
    ALTER TABLE dbo.product_quote ADD dongguan_price_excl DECIMAL(14,4) NULL;
IF COL_LENGTH(N'dbo.product_quote', N'hunan_price_excl') IS NULL
    ALTER TABLE dbo.product_quote ADD hunan_price_excl DECIMAL(14,4) NULL;
GO

/* 新模型不再要求工序。旧列保留，只为开发阶段可回查。 */
IF COL_LENGTH(N'dbo.product_quote', N'category_id') IS NOT NULL
    ALTER TABLE dbo.product_quote ALTER COLUMN category_id INT NULL;
IF COL_LENGTH(N'dbo.purchase_order_line', N'category_id') IS NOT NULL
    ALTER TABLE dbo.purchase_order_line ALTER COLUMN category_id INT NULL;
GO

IF COL_LENGTH(N'dbo.purchase_order_line', N'customer_quote_excl') IS NULL
    ALTER TABLE dbo.purchase_order_line ADD customer_quote_excl DECIMAL(14,4) NULL;
IF COL_LENGTH(N'dbo.purchase_order_line', N'dongguan_price_excl') IS NULL
    ALTER TABLE dbo.purchase_order_line ADD dongguan_price_excl DECIMAL(14,4) NULL;
IF COL_LENGTH(N'dbo.purchase_order_line', N'hunan_price_excl') IS NULL
    ALTER TABLE dbo.purchase_order_line ADD hunan_price_excl DECIMAL(14,4) NULL;
GO

PRINT N'====== 产品级核价结构升级完成 ======';
GO
