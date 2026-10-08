-- 123_widen_usage_precision.sql
-- 议题：92125-MA 猫公仔 6 款混装,一套成品用 2 个公仔(颜色混装),单款用量=2/6=1/3。
--       decimal(18,4) 只能存 0.3333/0.3334,需求 100000×1/3=33333.33 被圆成 33330/33340,
--       啤数(⌈数量/出模数6⌉)错算成 5555/5557(正确 5556);BOM 分数用法(1/6、1/3 等)普遍受益。
-- 结论：用量类列加宽 decimal(18,4) → decimal(18,6),1/3 可存 0.333333,需求 33333.3,啤数 5556。
--       (两列无索引/约束,ALTER 安全;存量 4 位小数值不受影响)。
-- 幂等：已加宽则跳过。

IF (SELECT NUMERIC_SCALE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '塑胶共用物料表' AND COLUMN_NAME = '用量') < 6
BEGIN
    ALTER TABLE [塑胶共用物料表] ALTER COLUMN [用量] decimal(18,6) NULL;
    PRINT N'123: 塑胶共用物料表.用量 已加宽至 decimal(18,6)。';
END
ELSE
    PRINT N'123: 塑胶共用物料表.用量 已不小于 6 位小数,跳过。';

IF (SELECT NUMERIC_SCALE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '款号物料明细表' AND COLUMN_NAME = '使用数量') < 6
BEGIN
    ALTER TABLE [款号物料明细表] ALTER COLUMN [使用数量] decimal(18,6) NULL;
    PRINT N'123: 款号物料明细表.使用数量 已加宽至 decimal(18,6)。';
END
ELSE
    PRINT N'123: 款号物料明细表.使用数量 已不小于 6 位小数,跳过。';
