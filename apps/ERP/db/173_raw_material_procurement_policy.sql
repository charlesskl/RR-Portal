-- 原料采购需求来源及常用/不常用政策。所有历史列保持NULL，不回填业务凭证。
IF COL_LENGTH(N'dbo.塑胶原料资料',N'常用原料') IS NULL
    ALTER TABLE [dbo].[塑胶原料资料] ADD [常用原料] bit NULL;

IF COL_LENGTH(N'dbo.原料采购订单',N'采购政策版本') IS NULL
    ALTER TABLE [dbo].[原料采购订单] ADD [采购政策版本] int NULL;

IF COL_LENGTH(N'dbo.原料采购订单明细',N'采购政策版本') IS NULL
    ALTER TABLE [dbo].[原料采购订单明细] ADD [采购政策版本] int NULL;
IF COL_LENGTH(N'dbo.原料采购订单明细',N'每库存单位KG') IS NULL
    ALTER TABLE [dbo].[原料采购订单明细] ADD [每库存单位KG] decimal(18,8) NULL;
IF COL_LENGTH(N'dbo.原料采购订单明细',N'每包重量') IS NULL
    ALTER TABLE [dbo].[原料采购订单明细] ADD [每包重量] decimal(18,8) NULL;

IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE [parent_object_id]=OBJECT_ID(N'dbo.原料采购订单') AND [name]=N'CK_原料采购订单_采购政策版本')
    EXEC(N'ALTER TABLE [dbo].[原料采购订单] WITH CHECK ADD CONSTRAINT [CK_原料采购订单_采购政策版本] CHECK([采购政策版本] IS NULL OR [采购政策版本]=1)');
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE [parent_object_id]=OBJECT_ID(N'dbo.原料采购订单明细') AND [name]=N'CK_原料采购订单明细_采购政策快照')
    EXEC(N'ALTER TABLE [dbo].[原料采购订单明细] WITH CHECK ADD CONSTRAINT [CK_原料采购订单明细_采购政策快照]
      CHECK([采购政策版本] IS NULL OR ([采购政策版本]=1 AND [每库存单位KG]>0 AND ([每包重量] IS NULL OR [每包重量]>0)))');
