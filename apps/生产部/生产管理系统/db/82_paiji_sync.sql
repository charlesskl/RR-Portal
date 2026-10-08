-- ============================================================================
-- 82_paiji_sync.sql
-- 排产系统入库单 → ERP塑胶入仓单 反向同步记录表,幂等可重复执行。
-- 用途:记录已同步的排产入库行id ↔ ERP入仓单号;防重复同步,且审核时据此防回环
--      (同步来源单审核时不再回推排产,见 PlasticReceiptService.ApprovePushAsync)。
-- ============================================================================
SET NOCOUNT ON;
IF OBJECT_ID(N'[排产同步记录]', N'U') IS NULL
BEGIN
    CREATE TABLE [排产同步记录](
        [排产入库ID] bigint NOT NULL PRIMARY KEY,
        [ERP单号] nvarchar(20) NOT NULL,
        [车间] nvarchar(4) NOT NULL,
        [同步时间] datetime2 NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX [IX_排产同步记录_ERP单号] ON [排产同步记录]([ERP单号]);
    PRINT N'排产同步记录 表已创建';
END
ELSE PRINT N'排产同步记录 表已存在,跳过';
