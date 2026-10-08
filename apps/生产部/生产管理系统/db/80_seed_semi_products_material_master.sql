-- ============================================================================
-- 80_seed_semi_products_material_master.sql
-- 把款号物料总表的款号登记进物料资料(物料类别=半成品),幂等可重复执行。
-- 原因:半成品入仓/领料/盘点明细单的 物料编号 有外键指向 物料资料(FK_9/13/21_查找),
--       半成品配件(款号)不入档会导致半成品入仓单保存报「物料/生产单号/款号不存在」。
-- ============================================================================
SET NOCOUNT ON;
INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[单位],[客户],[备注])
SELECT N'半成品', h.[款号], ISNULL(NULLIF(LTRIM(RTRIM(h.[款式])),N''), h.[款号]), N'PCS',
       COALESCE(NULLIF(LTRIM(RTRIM(h.[客户名称])),N''), NULLIF(LTRIM(RTRIM(h.[客户])),N'')),
       N'半成品配件自动入档(80_seed)'
FROM [款号物料总表] h
WHERE NULLIF(LTRIM(RTRIM(h.[款号])),N'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM [物料资料] m WHERE m.[物料编号]=h.[款号]);
PRINT N'半成品配件入档物料资料完成';
