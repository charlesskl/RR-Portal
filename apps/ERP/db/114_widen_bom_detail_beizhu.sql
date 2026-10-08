-- 114_widen_bom_detail_beizhu.sql
-- 议题：保存 92125-MA BOM 报「数据异常(2628)」(SQL Server 字符串截断)。
-- 根因：款号物料明细表.备注 nvarchar(20)，而 物料资料/塑胶物料资料.备注 均为 nvarchar(max)，
--       从物料档案带出的长备注(如塑胶 57001539 手链蛋黄形件,备注 32 字)写入即截断报错。
-- 结论：加宽 款号物料明细表.备注 20 → nvarchar(200)(该列无索引/约束,ALTER 安全;不截断用户数据)。
-- 幂等：已加宽则跳过。

IF (SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '款号物料明细表' AND COLUMN_NAME = '备注') < 200
BEGIN
    ALTER TABLE [款号物料明细表] ALTER COLUMN [备注] nvarchar(200) NULL;
    PRINT N'114: 款号物料明细表.备注 已加宽至 nvarchar(200)。';
END
ELSE
    PRINT N'114: 款号物料明细表.备注 已不小于 200,跳过。';
