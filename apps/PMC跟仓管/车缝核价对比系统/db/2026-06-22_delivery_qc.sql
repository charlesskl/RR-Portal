/* =====================================================================
   阶段四 · 回货 QC — delivery_note(回货批次/送货单头) + delivery_inspection(抽检明细)
   目标库 : StitchCostPro (SQL Server)
   说明   : 一张采购订单可分多批回货(delivery_note); 每批按订单产品明细行抽检(delivery_inspection)。
            人填: 送货数量/抽检数/不良数/退货数量; 不良率(=不良÷抽检)、实际交货(=送货−退货)由后端算不入库。
            QC 录入/删除后由后端重算订单 进度/状态/延期天数。本脚本只建 2 表, 幂等。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-22_delivery_qc.sql"
            (中文脚本必加 -f 65001, 否则报假的"列/表不存在")
   编制   : 2026-06-22
   ===================================================================== */
USE [StitchCostPro];
GO

/* ---------- 1. 回货批次 / 送货单头 ---------- */
IF OBJECT_ID(N'dbo.delivery_note', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.delivery_note (
        delivery_note_id INT IDENTITY(1,1) NOT NULL,
        order_id         INT           NOT NULL,                 -- 所属采购订单
        note_no          NVARCHAR(40)  NOT NULL,                 -- 送货单号(手填, 非空)
        received_date    DATE          NOT NULL,                 -- 实际回货日(算交期用)
        remark           NVARCHAR(500) NULL,
        created_by       INT           NULL,
        created_at       DATETIME2     NOT NULL CONSTRAINT DF_dn_created DEFAULT(SYSDATETIME()),
        updated_by       INT           NULL,
        updated_at       DATETIME2     NULL,
        CONSTRAINT PK_delivery_note PRIMARY KEY (delivery_note_id),
        CONSTRAINT FK_dn_order FOREIGN KEY (order_id) REFERENCES dbo.purchase_order(order_id)
    );
END
GO

/* ---------- 2. 抽检明细（一行 = 订单的一条产品明细） ---------- */
IF OBJECT_ID(N'dbo.delivery_inspection', N'U') IS NULL
BEGIN
    EXEC(N'CREATE TABLE dbo.delivery_inspection (
        inspection_id    INT IDENTITY(1,1) NOT NULL,
        delivery_note_id INT           NOT NULL,                 -- 所属回货批次
        line_id          INT           NOT NULL,                 -- 对应采购订单产品明细行
        send_qty         DECIMAL(14,2) NULL,                     -- 送货数量
        inspect_qty      DECIMAL(14,2) NULL,                     -- 抽检数(不良率分母)
        defect_qty       DECIMAL(14,2) NULL,                     -- 不良数
        return_qty       DECIMAL(14,2) NULL,                     -- 退货数量
        remark           NVARCHAR(200) NULL,
        CONSTRAINT PK_delivery_inspection PRIMARY KEY (inspection_id),
        CONSTRAINT FK_di_note FOREIGN KEY (delivery_note_id) REFERENCES dbo.delivery_note(delivery_note_id),
        CONSTRAINT FK_di_line FOREIGN KEY (line_id)          REFERENCES dbo.purchase_order_line(line_id)
    );');
END
GO

PRINT N'====== delivery_note / delivery_inspection 建表完成 ======';
GO
