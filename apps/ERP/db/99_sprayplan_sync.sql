-- ============================================================================
-- 99_sprayplan_sync.sql
-- 喷油部排期系统(sprayplan)入库申请单 → ERP塑胶入仓单 反向同步记录表,幂等可重复执行。
-- 用途:记录已同步的申请单号 ↔ ERP入仓单号;申请单号唯一(对方为 append-only 台账),
--      据此防重复同步(见 SprayPlanReceiptSyncService)。
-- ============================================================================
SET NOCOUNT ON;
IF OBJECT_ID(N'[喷油同步记录]', N'U') IS NULL
BEGIN
    CREATE TABLE [喷油同步记录](
        [申请单号] nvarchar(60) NOT NULL PRIMARY KEY,
        [ERP单号] nvarchar(30) NOT NULL,
        [同步时间] datetime NOT NULL DEFAULT GETDATE()
    );
    PRINT N'喷油同步记录 表已创建';
END
ELSE PRINT N'喷油同步记录 表已存在,跳过';
