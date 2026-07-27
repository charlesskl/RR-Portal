/* =====================================================================
   模块一 · 内外核价对比 — 1a 地基增量脚本（修订版）
   目标库 : StitchCostPro (SQL Server)
   说明   : 幂等、只新增不删旧。不影响已有 16 表数据。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-18_module1_foundation.sql"
            (-C 信任本地证书，绕过 ODBC Driver 18 默认强制 SSL 的报错)
   编制   : 2026-06-18
   ===================================================================== */
USE [StitchCostPro];
GO

/* ---------- 货号档案升级为「款式」级：加系列号、款号 ---------- */
IF COL_LENGTH(N'dbo.product', N'series_code') IS NULL
    ALTER TABLE dbo.product ADD series_code NVARCHAR(50) NULL;   -- 系列号/货号（如 15783）
GO
IF COL_LENGTH(N'dbo.product', N'style_no') IS NULL
    ALTER TABLE dbo.product ADD style_no NVARCHAR(20) NULL;       -- 款号（如 #1）
GO
-- 迁移现有行：把已有货号当系列，原品名当第 1 款（不改 product_code，保持外键稳定）
UPDATE dbo.product SET series_code = product_code WHERE series_code IS NULL;
UPDATE dbo.product SET style_no = N'#1'           WHERE style_no IS NULL;
GO

/* ---------- 供应商档案补字段：所在地、备注 ---------- */
IF COL_LENGTH(N'dbo.supplier', N'location') IS NULL
    ALTER TABLE dbo.supplier ADD location NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.supplier', N'remark') IS NULL
    ALTER TABLE dbo.supplier ADD remark NVARCHAR(200) NULL;
GO

/* ---------- 汇率/税率配置：可配置 + 带生效日期 ---------- */
IF OBJECT_ID(N'dbo.rate_config', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rate_config (
        config_id      INT IDENTITY(1,1) NOT NULL,
        rate_type      NVARCHAR(20)  NOT NULL,                 -- exchange(港币→人民币) / tax(税率)
        rate_value     DECIMAL(10,4) NOT NULL,                 -- 如 0.9000 / 0.1300
        effective_date DATE          NOT NULL,
        is_current     BIT           NOT NULL CONSTRAINT DF_rc_current DEFAULT(1),
        dept_id        INT           NOT NULL,
        remark         NVARCHAR(200) NULL,
        created_by     INT           NULL,
        created_at     DATETIME2     NOT NULL CONSTRAINT DF_rc_created DEFAULT(SYSDATETIME()),
        updated_by     INT           NULL,
        updated_at     DATETIME2     NULL,
        CONSTRAINT PK_rate_config PRIMARY KEY (config_id),
        CONSTRAINT FK_rc_dept FOREIGN KEY (dept_id) REFERENCES dbo.dept(dept_id)
    );
END
GO

PRINT N'====== 模块一 1a 地基（修订版）增量脚本执行完成 ======';
GO
