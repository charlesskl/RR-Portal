-- 115_widen_bom_detail_kuanshi.sql
-- 议题：BOM 物料设置页「产品名称」可编辑,保存时同步更新 款号总表.款式(nvarchar(50))。
--       同一 款式 值会写入 款号物料明细表.款式,但该列只有 nvarchar(30),
--       31~50 字的产品名称会在明细插入时截断报错(2628)。
-- 结论：加宽 款号物料明细表.款式 30 → nvarchar(50),与 款号总表/款号物料总表 对齐
--       (该列无索引/约束,ALTER 安全;不截断用户数据)。
-- 幂等：已加宽则跳过。

IF (SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '款号物料明细表' AND COLUMN_NAME = '款式') < 50
BEGIN
    ALTER TABLE [款号物料明细表] ALTER COLUMN [款式] nvarchar(50) NULL;
    PRINT N'115: 款号物料明细表.款式 已加宽至 nvarchar(50)。';
END
ELSE
    PRINT N'115: 款号物料明细表.款式 已不小于 50,跳过。';
