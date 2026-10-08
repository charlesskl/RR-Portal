-- P0 新增：库存滚存快照、单号流水、系统配置；并为登录锁定加列、移除明文错密依赖
SET XACT_ABORT ON;

IF OBJECT_ID(N'[结存快照表]') IS NULL
CREATE TABLE [结存快照表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [年月] char(6) NOT NULL,            -- 期末 yyyyMM
    [仓库] nvarchar(20) NOT NULL,
    [款号] nvarchar(30) NOT NULL,
    [款式] nvarchar(40) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [期初] decimal(18,4) NOT NULL DEFAULT 0,
    [本期入] decimal(18,4) NOT NULL DEFAULT 0,
    [本期出] decimal(18,4) NOT NULL DEFAULT 0,
    [结存] decimal(18,4) NOT NULL DEFAULT 0,
    [生成时间] datetime2(0) NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_结存快照_维度')
CREATE UNIQUE INDEX UX_结存快照_维度 ON [结存快照表]
    ([年月],[仓库],[款号],[色号],[颜色],[尺码]);

IF OBJECT_ID(N'[单号流水表]') IS NULL
CREATE TABLE [单号流水表] (
    [单据类型] nvarchar(20) NOT NULL,
    [业务日期] char(8) NOT NULL,        -- yyyyMMdd
    [当日流水] int NOT NULL,
    CONSTRAINT PK_单号流水 PRIMARY KEY ([单据类型],[业务日期])
);

IF OBJECT_ID(N'[系统配置表]') IS NULL
CREATE TABLE [系统配置表] (
    [键] nvarchar(60) NOT NULL PRIMARY KEY,
    [值] nvarchar(max) NULL,
    [是否加密] bit NOT NULL DEFAULT 0,
    [备注] nvarchar(200) NULL
);

IF COL_LENGTH(N'sysfileuser', N'登录失败次数') IS NULL
    ALTER TABLE [sysfileuser] ADD [登录失败次数] int NOT NULL DEFAULT 0;
IF COL_LENGTH(N'sysfileuser', N'锁定到期') IS NULL
    ALTER TABLE [sysfileuser] ADD [锁定到期] datetime2(0) NULL;

-- P0 引擎②（审核过账）：为可过账单头表补充审核留痕列 审核人/审核日期。
-- 基础架构(01_rebuild_schema.sql)仅有 [审核] 标志，无留痕列；此处幂等补齐，
-- 表名须与 ErpApi.Engines.Posting.PostableDocuments.Tables 白名单一致。
DECLARE @postable TABLE ([表名] sysname);
INSERT INTO @postable([表名]) VALUES
    (N'成品入仓单'),(N'成品出仓单'),(N'成品调拨单'),(N'成品盘点单'),(N'成品退仓单'),(N'成品退货单'),
    (N'采购入仓单'),(N'采购付款单'),(N'采购退仓单'),
    (N'销售出货单'),(N'销售收款单'),(N'销售退货单'),
    (N'领料单'),(N'退料单'),(N'调拨单'),(N'盘点单'),
    (N'发外加工单'),(N'发外回收单'),(N'发外加工付款单'),
    (N'半成品入仓单'),(N'半成品领料单'),(N'半成品盘点单'),
    (N'成品客户订货单'),(N'生产制单');

DECLARE @t sysname, @sql nvarchar(max);
DECLARE postable_cur CURSOR LOCAL FAST_FORWARD FOR SELECT [表名] FROM @postable;
OPEN postable_cur;
FETCH NEXT FROM postable_cur INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(QUOTENAME(@t)) IS NOT NULL
    BEGIN
        IF COL_LENGTH(@t, N'审核人') IS NULL
        BEGIN
            SET @sql = N'ALTER TABLE ' + QUOTENAME(@t) + N' ADD [审核人] nvarchar(20) NULL;';
            EXEC sp_executesql @sql;
        END
        IF COL_LENGTH(@t, N'审核日期') IS NULL
        BEGIN
            SET @sql = N'ALTER TABLE ' + QUOTENAME(@t) + N' ADD [审核日期] datetime2(0) NULL;';
            EXEC sp_executesql @sql;
        END
    END
    FETCH NEXT FROM postable_cur INTO @t;
END
CLOSE postable_cur;
DEALLOCATE postable_cur;

-- P1 取价(算法8)：报价资料 增加 生效日期，支持按生效日期取最新价
IF COL_LENGTH(N'报价资料', N'生效日期') IS NULL
    ALTER TABLE [报价资料] ADD [生效日期] datetime2(0) NULL;
