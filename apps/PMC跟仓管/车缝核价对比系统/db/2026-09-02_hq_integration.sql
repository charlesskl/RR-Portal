/* =====================================================================
   总部集成同步 — 采购订单/明细加总部字段 + 同步游标/日志表
   目标库 : StitchCostPro (SQL Server)
   说明   : 1) purchase_order / purchase_order_line 加 ext_main_id(总部记录幂等键)、source_updated_at；
            2) UQ_purchase_order_no 由 order_no 单列唯一改为 (order_no, supplier_id) 复合唯一，
               支持总部把同一订单号拆分给不同加工厂（规范第 8 节）；
            3) ext_main_id 建唯一筛选索引（仅非 NULL 参与唯一）；
            4) 新建 integration_sync_state(游标) / integration_sync_log(同步日志) 两表。幂等。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-09-02_hq_integration.sql"
   编制   : 2026-09-02
   ===================================================================== */
USE [StitchCostPro];
GO

/* ---------- 采购订单头：总部同步字段 ---------- */
IF COL_LENGTH(N'dbo.purchase_order', N'ext_main_id') IS NULL
    ALTER TABLE dbo.purchase_order ADD ext_main_id NVARCHAR(50) NULL;        -- 总部订单记录 id（首个落入本订单头的记录，溯源用）
GO
IF COL_LENGTH(N'dbo.purchase_order', N'source_updated_at') IS NULL
    ALTER TABLE dbo.purchase_order ADD source_updated_at DATETIME2 NULL;     -- 总部 updated_at 快照
GO

/* ---------- 采购订单明细行：总部同步字段（幂等键在行级） ---------- */
IF COL_LENGTH(N'dbo.purchase_order_line', N'ext_main_id') IS NULL
    ALTER TABLE dbo.purchase_order_line ADD ext_main_id NVARCHAR(50) NULL;   -- 总部订单记录 id（幂等键）
GO
IF COL_LENGTH(N'dbo.purchase_order_line', N'source_updated_at') IS NULL
    ALTER TABLE dbo.purchase_order_line ADD source_updated_at DATETIME2 NULL; -- 总部 updated_at 快照
GO

/* ---------- 订单号唯一约束：order_no 单列 → (order_no, supplier_id) 复合 ---------- */
IF EXISTS (
    SELECT 1
    FROM sys.indexes i
    JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE i.name = N'UQ_purchase_order_no' AND i.object_id = OBJECT_ID(N'dbo.purchase_order')
    GROUP BY i.index_id
    HAVING COUNT(*) = 1 AND MIN(c.name) = N'order_no')
    ALTER TABLE dbo.purchase_order DROP CONSTRAINT UQ_purchase_order_no;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_purchase_order_no' AND object_id = OBJECT_ID(N'dbo.purchase_order'))
    ALTER TABLE dbo.purchase_order ADD CONSTRAINT UQ_purchase_order_no UNIQUE (order_no, supplier_id);
GO

/* ---------- ext_main_id 唯一筛选索引（NULL 不参与唯一） ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_purchase_order_ext_main_id' AND object_id = OBJECT_ID(N'dbo.purchase_order'))
    CREATE UNIQUE INDEX UX_purchase_order_ext_main_id ON dbo.purchase_order(ext_main_id) WHERE ext_main_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_purchase_order_line_ext_main_id' AND object_id = OBJECT_ID(N'dbo.purchase_order_line'))
    CREATE UNIQUE INDEX UX_purchase_order_line_ext_main_id ON dbo.purchase_order_line(ext_main_id) WHERE ext_main_id IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_supplier_ext_main_id' AND object_id = OBJECT_ID(N'dbo.supplier'))
    CREATE UNIQUE INDEX UX_supplier_ext_main_id ON dbo.supplier(ext_main_id) WHERE ext_main_id IS NOT NULL;
GO

/* ---------- 同步游标表：每个来源 × 资源一行 ---------- */
IF OBJECT_ID(N'dbo.integration_sync_state', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.integration_sync_state (
        source                 NVARCHAR(40)   NOT NULL,                  -- 来源标识（hq=总部加工厂系统）
        resource_type          NVARCHAR(40)   NOT NULL,                  -- factories / orders
        last_cursor_updated_at NVARCHAR(40)   NULL,                      -- 上一页 next_updated_after（原样保存）
        last_cursor_id         NVARCHAR(64)   NULL,                      -- 上一页 next_cursor_id
        last_success_at        DATETIME2      NULL,                      -- 最近一次整轮成功时间
        last_error             NVARCHAR(1000) NULL,                      -- 最近一次失败信息
        updated_at             DATETIME2      NOT NULL CONSTRAINT DF_iss_updated DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT PK_integration_sync_state PRIMARY KEY (source, resource_type)
    );
END
GO

/* ---------- 同步日志表：一轮同步每个资源一行 ---------- */
IF OBJECT_ID(N'dbo.integration_sync_log', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.integration_sync_log (
        id             INT IDENTITY(1,1) NOT NULL,
        started_at     DATETIME2      NOT NULL,                          -- 本资源同步开始时间
        finished_at    DATETIME2      NULL,
        resource_type  NVARCHAR(40)   NOT NULL,
        received_count INT            NOT NULL CONSTRAINT DF_isl_received DEFAULT(0),
        created_count  INT            NOT NULL CONSTRAINT DF_isl_created  DEFAULT(0),
        updated_count  INT            NOT NULL CONSTRAINT DF_isl_updated  DEFAULT(0),
        skipped_count  INT            NOT NULL CONSTRAINT DF_isl_skipped  DEFAULT(0),
        failed_count   INT            NOT NULL CONSTRAINT DF_isl_failed   DEFAULT(0),
        status         NVARCHAR(20)   NOT NULL,                          -- success / failed
        error_message  NVARCHAR(2000) NULL,
        CONSTRAINT PK_integration_sync_log PRIMARY KEY (id)
    );
END
GO

PRINT N'====== 总部集成同步（hq_integration）增量脚本执行完成 ======';
GO
