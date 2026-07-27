/* =====================================================================
   阶段一 · 产品内部核价 — product_quote 建表
   目标库 : StitchCostPro (SQL Server)
   说明   : 一行 = 一个具体款式的一组产品总价。幂等。
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-20_product_quote.sql"
   编制   : 2026-06-20
   ===================================================================== */
USE [StitchCostPro];
GO

IF OBJECT_ID(N'dbo.product_quote', N'U') IS NULL
BEGIN
    EXEC(N'CREATE TABLE dbo.product_quote (
        quote_id            INT IDENTITY(1,1) NOT NULL,
        product_id          INT           NOT NULL,                 -- 款
        customer_name       NVARCHAR(120) NULL,
        customer_quote_excl DECIMAL(14,4) NULL,
        internal_price_excl DECIMAL(14,4) NOT NULL,                 -- 内部核价(不含税)
        dongguan_price_excl DECIMAL(14,4) NULL,
        hunan_price_excl    DECIMAL(14,4) NULL,
        remark              NVARCHAR(500) NULL,
        dept_id             INT           NOT NULL,
        created_by          INT           NULL,
        created_at          DATETIME2     NOT NULL CONSTRAINT DF_pq_created DEFAULT(SYSDATETIME()),
        updated_by          INT           NULL,
        updated_at          DATETIME2     NULL,
        CONSTRAINT PK_product_quote PRIMARY KEY (quote_id),
        CONSTRAINT UQ_product_quote UNIQUE (product_id),
        CONSTRAINT FK_pq_product  FOREIGN KEY (product_id)  REFERENCES dbo.product(product_id),
        CONSTRAINT FK_pq_dept     FOREIGN KEY (dept_id)     REFERENCES dbo.dept(dept_id)
    );');
END
GO

PRINT N'====== product_quote(产品内部核价) 建表完成 ======';
GO
