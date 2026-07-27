/* =====================================================================
   阶段二 · 加工厂信息库 — supplier 表补字段（对齐《车缝-加工厂信息统计表》）
   目标库 : StitchCostPro (SQL Server)
   说明   : 幂等、只新增不删旧。复用已有 contact(联系人)/main_process(加工类型)。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-20_supplier_fields.sql"
   编制   : 2026-06-20
   ===================================================================== */
USE [StitchCostPro];
GO

IF COL_LENGTH(N'dbo.supplier', N'phone') IS NULL
    ALTER TABLE dbo.supplier ADD phone NVARCHAR(30) NULL;            -- 联系电话(文字存,不当数字)
GO
IF COL_LENGTH(N'dbo.supplier', N'address') IS NULL
    ALTER TABLE dbo.supplier ADD address NVARCHAR(200) NULL;         -- 工厂地址(完整)
GO
IF COL_LENGTH(N'dbo.supplier', N'equipment_count') IS NULL
    ALTER TABLE dbo.supplier ADD equipment_count INT NULL;           -- 设备台数/生产拉线
GO
IF COL_LENGTH(N'dbo.supplier', N'machines_for_us') IS NULL
    ALTER TABLE dbo.supplier ADD machines_for_us INT NULL;           -- 帮我们生产的机台/生产线
GO
IF COL_LENGTH(N'dbo.supplier', N'employee_count') IS NULL
    ALTER TABLE dbo.supplier ADD employee_count INT NULL;            -- 员工人数
GO
IF COL_LENGTH(N'dbo.supplier', N'monthly_capacity') IS NULL
    ALTER TABLE dbo.supplier ADD monthly_capacity NVARCHAR(50) NULL; -- 月产能(可"100万"或数字)
GO
IF COL_LENGTH(N'dbo.supplier', N'qualification') IS NULL
    ALTER TABLE dbo.supplier ADD qualification NVARCHAR(100) NULL;   -- 环评/消防/安监资质
GO
IF COL_LENGTH(N'dbo.supplier', N'scope') IS NULL
    ALTER TABLE dbo.supplier ADD scope NVARCHAR(50) NULL;            -- 所属范围(如 车缝部)
GO

PRINT N'====== 加工厂信息字段增量脚本执行完成 ======';
GO
