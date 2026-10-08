-- 采购分析审核:采购物料分析(来料下单)的独立审核层。
-- 生产通知单审核 ≠ 采购分析审核:生产单审完后,采购分析仍为未审核;采购员在「采购物料分析」
-- 查看明细后再点审核,只有分析已审核才允许下采购订单(PurchaseOrderService basis/create 同查)。
-- 无 FK:生产单删除时由 ProductionService.DeleteAsync 顺带清行(孤儿行不影响查询口径)。
IF OBJECT_ID(N'[dbo].[采购分析审核]', N'U') IS NULL
CREATE TABLE [dbo].[采购分析审核](
    [生产单号]   nvarchar(40)  NOT NULL,
    [审核]       nvarchar(4)   NOT NULL CONSTRAINT [DF_采购分析审核_审核] DEFAULT N'0',
    [审核人]     nvarchar(100) NULL,
    [审核时间]   datetime      NULL,
    CONSTRAINT [PK_采购分析审核] PRIMARY KEY ([生产单号])
);
