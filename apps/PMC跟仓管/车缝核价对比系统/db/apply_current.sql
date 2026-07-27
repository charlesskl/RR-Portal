/*
  StitchCostPro 现有数据库升级入口（SQLCMD 模式）
  ---------------------------------------------
  用法（须从 db 目录执行）：
    sqlcmd -S "(localdb)\MSSQLLocalDB" -d StitchCostPro -f 65001 -i apply_current.sql

  所有增量脚本均按可重复执行方式编写；本入口不会主动重建基础表。
*/

:on error exit

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

PRINT N'StitchCostPro 当前数据库升级完成。';
GO
