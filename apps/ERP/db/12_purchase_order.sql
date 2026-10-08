-- P-采购管理：采购物料单/采购订单 单据。
-- [采购订单] 原表(01_rebuild_schema)有 [审核] 标志但无审核留痕列；
-- 此处幂等补齐 审核人/审核日期，类型与 03_p0_additions 对其它可过账单头表所用一致
-- (审核人 nvarchar(20)、审核日期 datetime2(0))，并把 采购订单 纳入 PostableDocuments 白名单。
-- 幂等：可在 ERP_TEST_DB / ERP_DB 上重复执行。
SET XACT_ABORT ON;

IF COL_LENGTH(N'采购订单', N'审核人') IS NULL
    ALTER TABLE [采购订单] ADD [审核人] nvarchar(20) NULL;

IF COL_LENGTH(N'采购订单', N'审核日期') IS NULL
    ALTER TABLE [采购订单] ADD [审核日期] datetime2(0) NULL;
