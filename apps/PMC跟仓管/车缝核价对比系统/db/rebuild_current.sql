/*
  StitchCostPro 当前完整重建入口（SQLCMD 模式）
  ---------------------------------------------
  用法（须从 db 目录执行）：
    sqlcmd -S "(localdb)\MSSQLLocalDB" -f 65001 -i rebuild_current.sql

  注意：这是破坏性重建，会删除 StitchCostPro 数据库中的现有业务数据。
  日常升级现有数据库请执行 apply_current.sql。
*/

:on error exit

/* 先清理基础脚本编制后新增的表，避免它们的外键阻止基础表重建。 */
IF DB_ID(N'StitchCostPro') IS NOT NULL
BEGIN
    EXEC(N'USE [StitchCostPro];
      IF OBJECT_ID(N''dbo.order_price_history'', N''U'') IS NOT NULL DROP TABLE dbo.order_price_history;
      IF OBJECT_ID(N''dbo.quality_defect'', N''U'') IS NOT NULL DROP TABLE dbo.quality_defect;
      IF OBJECT_ID(N''dbo.quality_inspection'', N''U'') IS NOT NULL DROP TABLE dbo.quality_inspection;
      IF OBJECT_ID(N''dbo.delivery_inspection'', N''U'') IS NOT NULL DROP TABLE dbo.delivery_inspection;
      IF OBJECT_ID(N''dbo.delivery_note'', N''U'') IS NOT NULL DROP TABLE dbo.delivery_note;
      IF OBJECT_ID(N''dbo.purchase_order_line'', N''U'') IS NOT NULL DROP TABLE dbo.purchase_order_line;
      IF OBJECT_ID(N''dbo.purchase_order'', N''U'') IS NOT NULL DROP TABLE dbo.purchase_order;
      IF OBJECT_ID(N''dbo.product_quote'', N''U'') IS NOT NULL DROP TABLE dbo.product_quote;
      IF OBJECT_ID(N''dbo.price_monitor'', N''U'') IS NOT NULL DROP TABLE dbo.price_monitor;
      IF OBJECT_ID(N''dbo.rate_config'', N''U'') IS NOT NULL DROP TABLE dbo.rate_config;');
END
GO

:r rebuild_schema.sql
:r 2026-06-18_module1_foundation.sql
:r 2026-06-20_supplier_fields.sql
:r 2026-06-20_product_quote.sql
:r 2026-06-20_purchase_order.sql
:r 2026-06-20_order_tracking.sql
:r 2026-06-22_delivery_qc.sql
:r 2026-06-22_quality.sql
:r 2026-06-23_product_quote_remark.sql
:r 2026-06-26_sysuser_role.sql
:r 2026-07-16_order_pricing.sql
:r 2026-07-24_product_level_pricing.sql
:r 2026-07-24_remove_process_legacy.sql
:r 2026-09-02_hq_integration.sql

PRINT N'StitchCostPro 当前完整结构重建完成。';
GO
