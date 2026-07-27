/* =====================================================================
   品质管理模块 · quality_inspection(品质验货明细) + quality_defect(不良类型子表)
   目标库 : StitchCostPro (SQL Server)
   说明   : 独立录入模块(替代阶段4塞在订单行的简单回货QC)。
            一行明细 = 一次回货的一个款: 关联采购订单+款(product)+加工厂快照, 记收货/质检/验货。
            不良类型(爆口/线头/污染固定 + 其它任意)存子表 quality_defect, 一对多。
            自动算不入库: 抽检/全检(质检<收货=抽检,=则全检)、检验比例(质检÷收货)、
                          各不良类型占比(数量÷质检)、平均次品率、主要质量短板(占比最高)。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-22_quality.sql"
   编制   : 2026-06-22
   ===================================================================== */
USE [StitchCostPro];
GO

/* ---------- 0. 旧占位表清理 ----------
   仅当 quality_inspection 仍是没有 order_id 的早期占位结构时迁移。
   当前结构重复执行绝不删表，避免升级入口误清品质数据。 */
IF OBJECT_ID(N'dbo.quality_inspection', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.quality_inspection', N'order_id') IS NULL
BEGIN
    IF OBJECT_ID(N'dbo.quality_defect', N'U') IS NOT NULL DROP TABLE dbo.quality_defect;
    DROP TABLE dbo.quality_inspection;
END
GO

/* ---------- 1. 品质验货明细 ---------- */
IF OBJECT_ID(N'dbo.quality_inspection', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.quality_inspection (
        inspection_id INT IDENTITY(1,1) NOT NULL,
        order_id      INT           NOT NULL,                 -- 采购订单
        product_id    INT           NOT NULL,                 -- 款(含货号 series_code), 手工表"品名/规格"
        supplier_id   INT           NOT NULL,                 -- 加工厂(从订单带出的快照, 汇总主维度)
        received_date DATE          NOT NULL,                 -- 收货日期
        check_date    DATE          NULL,                     -- 查货/返工日期
        ma_no         NVARCHAR(50)  NULL,                     -- MA号(手填)
        delivery_no   NVARCHAR(60)  NULL,                     -- 送货单号
        received_qty  DECIMAL(14,2) NULL,                     -- 收货数量
        qc_qty        DECIMAL(14,2) NULL,                     -- 质检数量
        ab_group      NVARCHAR(20)  NULL,                     -- A/B组
        inspector     NVARCHAR(50)  NULL,                     -- 检验员
        rectification NVARCHAR(200) NULL,                     -- 整改情况
        remark        NVARCHAR(500) NULL,
        created_by    INT           NULL,
        created_at    DATETIME2     NOT NULL CONSTRAINT DF_qi_created DEFAULT(SYSDATETIME()),
        updated_by    INT           NULL,
        updated_at    DATETIME2     NULL,
        CONSTRAINT PK_quality_inspection PRIMARY KEY (inspection_id),
        CONSTRAINT FK_qi_order    FOREIGN KEY (order_id)    REFERENCES dbo.purchase_order(order_id),
        CONSTRAINT FK_qi_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
        CONSTRAINT FK_qi_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id)
    );
END
GO

/* ---------- 2. 不良类型子表(一对多) ---------- */
IF OBJECT_ID(N'dbo.quality_defect', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.quality_defect (
        defect_id     INT IDENTITY(1,1) NOT NULL,
        inspection_id INT           NOT NULL,                 -- 所属品质验货明细
        defect_type   NVARCHAR(100) NOT NULL,                 -- 不良类型
        qty           DECIMAL(14,2) NULL,                     -- 该类型不良数量(占比=qty÷质检, 算不存)
        CONSTRAINT PK_quality_defect PRIMARY KEY (defect_id),
        CONSTRAINT FK_qd_inspection FOREIGN KEY (inspection_id) REFERENCES dbo.quality_inspection(inspection_id)
    );
END
GO

PRINT N'====== quality_inspection / quality_defect 建表完成 ======';
GO
