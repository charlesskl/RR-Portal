-- ============================================================================
-- 81_paiji_push.sql
-- 塑胶单据审核后推送「AI注塑啤机排产系统」的推送记录表,幂等可重复执行。
-- 用途:记录本ERP单据 ↔ 远端排产记录id 的对应关系,反审核/重推时据此删远端。
--   单据类型: 采购订单 / 入仓单
--   排产端:   orders(订单导入) / warehouse-orders(入库单),删远端时按它决定 URL
-- ============================================================================
SET NOCOUNT ON;
IF OBJECT_ID(N'[排产推送记录]', N'U') IS NULL
BEGIN
    CREATE TABLE [排产推送记录](
        [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [单据类型] nvarchar(20) NOT NULL,
        [单据号] nvarchar(20) NOT NULL,
        [排产订单ID] bigint NOT NULL,
        [排产端] nvarchar(20) NOT NULL,
        [车间] nvarchar(4) NOT NULL,
        [推送时间] datetime2 NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX [IX_排产推送记录_单据号] ON [排产推送记录]([单据类型],[单据号]);
    PRINT N'排产推送记录 表已创建';
END
ELSE PRINT N'排产推送记录 表已存在,跳过';
