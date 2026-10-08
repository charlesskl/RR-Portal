-- 116_widen_production_header_beizhu.sql
-- 议题:排期行「生产下单」生成生产通知单,预填备注「排期下单:ZURU PO=xxx 客PO=xxx 货号=xxx」
--       约 50 字,但 生产制单.备注 只有 nvarchar(40),插入即 2628 截断报错(请求失败 500)。
-- 结论:加宽 生产制单.备注 40 → nvarchar(200),与 生产排期批次/生产通知单MO单.备注 对齐
--       (该列无索引/约束,ALTER 安全;不截断用户数据)。
-- 幂等:已加宽则跳过。

IF (SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '生产制单' AND COLUMN_NAME = '备注') < 200
BEGIN
    ALTER TABLE [生产制单] ALTER COLUMN [备注] nvarchar(200) NULL;
    PRINT N'116: 生产制单.备注 已加宽至 nvarchar(200)。';
END
ELSE
    PRINT N'116: 生产制单.备注 已不小于 200,跳过。';
