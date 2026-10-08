-- 备品入库：三种采购入仓明细(来料仓/塑胶仓/原料仓)加 备品 标记列。
-- 备品='1' 的行=供应商多送的备品：允许超出订单订购数量入库,不计入订单「已入仓」累计(不顶欠数/进度);
-- 库存台账按 物料×仓库 聚合天然计入,审核后即可用库存,后续下单自动抵扣。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[采购入仓明细单]') AND name=N'备品')
    ALTER TABLE [采购入仓明细单] ADD [备品] char(1) NOT NULL CONSTRAINT [DF_采购入仓明细单_备品] DEFAULT ('0');
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶入仓明细单]') AND name=N'备品')
    ALTER TABLE [塑胶入仓明细单] ADD [备品] char(1) NOT NULL CONSTRAINT [DF_塑胶入仓明细单_备品] DEFAULT ('0');
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[原料入仓明细单]') AND name=N'备品')
    ALTER TABLE [原料入仓明细单] ADD [备品] char(1) NOT NULL CONSTRAINT [DF_原料入仓明细单_备品] DEFAULT ('0');
GO
