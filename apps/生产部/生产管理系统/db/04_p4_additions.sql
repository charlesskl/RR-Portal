-- P4 M6 裁床：统一把 裁床总表/裁床明细表 (原 nvarchar(10)) 与 计件表 (原 nvarchar(15)) 的 裁床单号 扩到 nvarchar(20)，
-- 因单号(前缀+yyyyMMdd+3位=13字符)装不下；裁床总表 不在 P0 可过账白名单，补 审核人/审核日期 留痕列(供审核过账引擎②)。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'裁床总表', N'裁床单号') < 40   -- COL_LENGTH 返回字节数：nvarchar(20)=40；<40 表示尚未扩宽(10→20或15→30均<40)，幂等
    ALTER TABLE [裁床总表] ALTER COLUMN [裁床单号] nvarchar(20);
IF COL_LENGTH(N'裁床明细表', N'裁床单号') < 40
    ALTER TABLE [裁床明细表] ALTER COLUMN [裁床单号] nvarchar(20);
IF COL_LENGTH(N'计件表', N'裁床单号') < 40
    ALTER TABLE [计件表] ALTER COLUMN [裁床单号] nvarchar(20);

IF COL_LENGTH(N'裁床总表', N'审核人') IS NULL
    ALTER TABLE [裁床总表] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'裁床总表', N'审核日期') IS NULL
    ALTER TABLE [裁床总表] ADD [审核日期] datetime2(0) NULL;
