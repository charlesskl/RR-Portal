-- 塑胶采购订单明细:原料快照(啤机下单自动扣原料)。EF 不迁移·幂等。
-- 关联链:明细.物料编号 → 塑胶物料资料.用料名称 → 塑胶原料资料.物料名称 → 原料编号;
-- 原料用量KG = 数量(件) × 单件克重(原胶件单净重,空则 整啤净重/出模数) / 1000;
-- 与运行时口径一致(PlasticPurchaseOrderService):匹配到用料名称即回填编号/名称,克重未知时 KG 留 NULL。
IF COL_LENGTH(N'塑胶采购订单明细', N'原料编号') IS NULL
    ALTER TABLE [塑胶采购订单明细] ADD [原料编号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶采购订单明细', N'原料名称') IS NULL
    ALTER TABLE [塑胶采购订单明细] ADD [原料名称] nvarchar(80) NULL;
IF COL_LENGTH(N'塑胶采购订单明细', N'原料用量KG') IS NULL
    ALTER TABLE [塑胶采购订单明细] ADD [原料用量KG] decimal(18,4) NULL;
GO
-- 存量单据回填(只补未填的行):匹配到用料名称即回填编号/名称;克重未知时 原料用量KG 落 NULL
UPDATE d
SET d.[原料编号] = r.[物料编号],
    d.[原料名称] = r.[物料名称],
    d.[原料用量KG] = CASE WHEN COALESCE(m.[原胶件单净重], m.[整啤净重]/NULLIF(m.[出模数],0)) > 0
                          THEN ROUND(ISNULL(d.[数量],0) * COALESCE(m.[原胶件单净重], m.[整啤净重]/NULLIF(m.[出模数],0)) / 1000, 4)
                          ELSE NULL END
FROM [塑胶采购订单明细] d
JOIN [塑胶物料资料] m ON m.[物料编号] = d.[物料编号]
JOIN [塑胶原料资料] r ON r.[物料名称] = m.[用料名称]
WHERE d.[原料编号] IS NULL;
