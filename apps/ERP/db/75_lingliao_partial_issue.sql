-- 领料单分次出库：领料明细单 加 已出数量(累计已出库数量)。装配部开领料单(申请)→来料仓分次出库，已出数量 累计；全部出完自动置审核='1'(完成)。
-- 台账/库存按 已出数量 计已出库(部分出库也实时扣库存)；旧单据:已审核且 已出数量 为空=整单已出(旧审核过账模式,不改)。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[领料明细单]') AND name=N'已出数量')
BEGIN
    ALTER TABLE [领料明细单] ADD [已出数量] decimal(18,4) NULL;
END;
GO
-- 存量已审核领料单:出库量=申请数量(旧审核过账模式),回填保证台账/报表统一读 已出数量
UPDATE d SET [已出数量]=d.[数量]
FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' AND d.[已出数量] IS NULL;
