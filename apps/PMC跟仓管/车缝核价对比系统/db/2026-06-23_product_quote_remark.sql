/* =====================================================================
   核价录入 · product_quote 加「备注」列（按 款×工艺 记工价备注，如"用花机/简费另算"）
   目标库 : StitchCostPro (SQL Server)
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-23_product_quote_remark.sql"
   编制   : 2026-06-23  幂等
   ===================================================================== */
USE [StitchCostPro];
GO

IF COL_LENGTH(N'dbo.product_quote', N'remark') IS NULL
BEGIN
    ALTER TABLE dbo.product_quote ADD remark NVARCHAR(200) NULL;   -- 工价备注
END
GO

PRINT N'====== product_quote.remark 列已就绪 ======';
GO
