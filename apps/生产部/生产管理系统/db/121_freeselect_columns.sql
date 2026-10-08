-- 121_freeselect_columns.sql — 自由选产品版补列收编。EF 不迁移·幂等（COL_LENGTH 守卫，可重复执行）。
-- 背景：以下补列原由非编号 migrate_finished_receipt_freeselect.sql / migrate_semi_issue_freeselect.sql
--       执行，run-db.ps1 按编号自动枚举不会跑 migrate_*，全新建库会缺这些列，故收编为编号迁移；
--       原 migrate_* 文件保留不动。
-- 来源（逐列照抄）：成品入仓单 2 列 + 成品入仓明细单 7 列 ← migrate_finished_receipt_freeselect.sql；
--                  半成品领料单 6 列 ← migrate_semi_issue_freeselect.sql（审核日期已存在，不加）。
-- GO 分批说明：本文件只含 COL_LENGTH 守卫的 ALTER ADD（守卫取字符串字面量，编译期不绑定新列），
--             且后续语句不引用新列，故无需 GO 分批；新增引用新列的语句时必须先在前面补 GO。
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- ===== 成品入仓单/成品入仓明细单 玩具列（← migrate_finished_receipt_freeselect.sql） =====
-- 成品入仓单 单头补列
IF COL_LENGTH(N'[成品入仓单]', N'订单单号') IS NULL ALTER TABLE [成品入仓单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[成品入仓单]', N'入库单号') IS NULL ALTER TABLE [成品入仓单] ADD [入库单号] nvarchar(40) NULL;

-- 成品入仓明细单 补列（配件编号/订单单号/客户/货号/名称/产品装配名称/箱数）
IF COL_LENGTH(N'[成品入仓明细单]', N'订单单号') IS NULL ALTER TABLE [成品入仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'配件编号') IS NULL ALTER TABLE [成品入仓明细单] ADD [配件编号] nvarchar(80) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'客户') IS NULL ALTER TABLE [成品入仓明细单] ADD [客户] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'货号') IS NULL ALTER TABLE [成品入仓明细单] ADD [货号] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'名称') IS NULL ALTER TABLE [成品入仓明细单] ADD [名称] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'产品装配名称') IS NULL ALTER TABLE [成品入仓明细单] ADD [产品装配名称] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'箱数') IS NULL ALTER TABLE [成品入仓明细单] ADD [箱数] decimal(18,4) NULL;

-- ===== 半成品领料单 头补列（← migrate_semi_issue_freeselect.sql） =====
IF COL_LENGTH(N'半成品领料单', N'拉长') IS NULL
    ALTER TABLE [半成品领料单] ADD [拉长] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'收件人') IS NULL
    ALTER TABLE [半成品领料单] ADD [收件人] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'领料备注') IS NULL
    ALTER TABLE [半成品领料单] ADD [领料备注] nvarchar(40) NULL;
IF COL_LENGTH(N'半成品领料单', N'件数') IS NULL
    ALTER TABLE [半成品领料单] ADD [件数] decimal(18,4) NULL;
IF COL_LENGTH(N'半成品领料单', N'卡板数') IS NULL
    ALTER TABLE [半成品领料单] ADD [卡板数] decimal(18,4) NULL;
IF COL_LENGTH(N'半成品领料单', N'制单人') IS NULL
    ALTER TABLE [半成品领料单] ADD [制单人] nvarchar(20) NULL;

COMMIT TRANSACTION;
