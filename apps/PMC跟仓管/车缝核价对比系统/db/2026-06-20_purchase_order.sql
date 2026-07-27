/* =====================================================================
   阶段三 · 采购订单 — purchase_order(订单头) + purchase_order_line(明细行)
   目标库 : StitchCostPro (SQL Server)
   说明   : 订单头=加工厂+下单日+交付日+状态；明细行=一个具体款式+数量+价格快照。幂等。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-20_purchase_order.sql"
   编制   : 2026-06-20
   ===================================================================== */
USE [StitchCostPro];
GO

IF OBJECT_ID(N'dbo.purchase_order', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.purchase_order (
        order_id      INT IDENTITY(1,1) NOT NULL,
        order_no      NVARCHAR(40)  NOT NULL,                  -- 订单号(自动生成 PO日期-序号)
        supplier_id   INT           NOT NULL,                  -- 加工厂
        order_date    DATE          NOT NULL,                  -- 下单日
        delivery_date DATE          NULL,                      -- 交付日
        status        NVARCHAR(20)  NOT NULL CONSTRAINT DF_po_status DEFAULT(N'已下单'),
        remark        NVARCHAR(500) NULL,
        dept_id       INT           NOT NULL,
        created_by    INT           NULL,
        created_at    DATETIME2     NOT NULL CONSTRAINT DF_po_created DEFAULT(SYSDATETIME()),
        updated_by    INT           NULL,
        updated_at    DATETIME2     NULL,
        CONSTRAINT PK_purchase_order PRIMARY KEY (order_id),
        CONSTRAINT UQ_purchase_order_no UNIQUE (order_no),
        CONSTRAINT FK_po_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.supplier(supplier_id),
        CONSTRAINT FK_po_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
    );
END
GO

IF OBJECT_ID(N'dbo.purchase_order_line', N'U') IS NULL
BEGIN
    EXEC(N'CREATE TABLE dbo.purchase_order_line (
        line_id              INT IDENTITY(1,1) NOT NULL,
        order_id             INT           NOT NULL,           -- 所属订单
        product_id           INT           NOT NULL,           -- 款
        qty                  DECIMAL(14,2) NULL,               -- 数量
        unit                 NVARCHAR(20)  NULL,               -- 单位
        outsource_price_excl DECIMAL(14,4) NULL,               -- 外发价(不含税)
        customer_quote_excl  DECIMAL(14,4) NULL,               -- 报客价快照
        internal_price_excl  DECIMAL(14,4) NULL,               -- 下单时内部核价快照(从 product_quote 带出)
        dongguan_price_excl  DECIMAL(14,4) NULL,               -- 东莞参考价快照
        hunan_price_excl     DECIMAL(14,4) NULL,               -- 湖南参考价快照
        CONSTRAINT PK_purchase_order_line PRIMARY KEY (line_id),
        CONSTRAINT FK_pol_order    FOREIGN KEY (order_id)    REFERENCES dbo.purchase_order(order_id),
        CONSTRAINT FK_pol_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id)
    );');
END
GO

PRINT N'====== purchase_order / purchase_order_line 建表完成 ======';
GO
