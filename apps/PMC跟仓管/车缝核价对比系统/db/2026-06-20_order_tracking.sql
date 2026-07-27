/* =====================================================================
   阶段三补 · 采购订单加生产/交期跟踪字段
   目标库 : StitchCostPro (SQL Server)
   说明   : purchase_order 加 生产完成进度/延期天数/主要延期原因。幂等。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-20_order_tracking.sql"
   编制   : 2026-06-20
   ===================================================================== */
USE [StitchCostPro];
GO

IF COL_LENGTH(N'dbo.purchase_order', N'production_progress') IS NULL
    ALTER TABLE dbo.purchase_order ADD production_progress INT NOT NULL CONSTRAINT DF_po_progress DEFAULT(0);  -- 生产完成进度(%)
GO
IF COL_LENGTH(N'dbo.purchase_order', N'delay_days') IS NULL
    ALTER TABLE dbo.purchase_order ADD delay_days INT NOT NULL CONSTRAINT DF_po_delay DEFAULT(0);              -- 延期天数
GO
IF COL_LENGTH(N'dbo.purchase_order', N'delay_reason') IS NULL
    ALTER TABLE dbo.purchase_order ADD delay_reason NVARCHAR(200) NULL;                                        -- 主要延期原因
GO

PRINT N'====== purchase_order 生产/交期跟踪字段 增量完成 ======';
GO
