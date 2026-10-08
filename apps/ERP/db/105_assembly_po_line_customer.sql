-- 装配加工采购单生产明细 加行级 客户编号/客户名称/装配方式/备注：
-- 支持一单多行产品、每行产品带自己的客户与装配方式；旧数据该四列为 NULL,
-- 取单时回落单头 客户/装配方式/备注(见 AssemblyPurchaseOrderService.GetAsync)。幂等(可重跑)。
SET XACT_ABORT ON;

IF COL_LENGTH(N'装配加工采购单生产明细', N'客户编号') IS NULL
BEGIN
    ALTER TABLE [装配加工采购单生产明细] ADD [客户编号] nvarchar(50) NULL;
END;
GO
IF COL_LENGTH(N'装配加工采购单生产明细', N'客户名称') IS NULL
BEGIN
    ALTER TABLE [装配加工采购单生产明细] ADD [客户名称] nvarchar(100) NULL;
END;
GO
IF COL_LENGTH(N'装配加工采购单生产明细', N'装配方式') IS NULL
BEGIN
    ALTER TABLE [装配加工采购单生产明细] ADD [装配方式] nvarchar(50) NULL;
END;
GO
IF COL_LENGTH(N'装配加工采购单生产明细', N'备注') IS NULL
BEGIN
    ALTER TABLE [装配加工采购单生产明细] ADD [备注] nvarchar(200) NULL;
END;
GO
