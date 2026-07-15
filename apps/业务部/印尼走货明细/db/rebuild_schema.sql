-- 印尼走货明细系统 — T-SQL Schema (SQL Server 2019+)
-- 由 印尼明细/backend/db/schema.sql (SQLite) 翻译而来
-- 运行方式: sqlcmd -S (localdb)\MSSQLLocalDB -i rebuild_schema.sql

IF DB_ID('IndoShipping') IS NULL
    CREATE DATABASE IndoShipping;
GO
USE IndoShipping;
GO

-- ============ 顺序: 先 drop 反向 (子表 → 父表) ============
IF OBJECT_ID('dbo.shipment_items', 'U')   IS NOT NULL DROP TABLE dbo.shipment_items;
IF OBJECT_ID('dbo.shipments', 'U')        IS NOT NULL DROP TABLE dbo.shipments;
IF OBJECT_ID('dbo.outbound', 'U')         IS NOT NULL DROP TABLE dbo.outbound;
IF OBJECT_ID('dbo.po_items', 'U')         IS NOT NULL DROP TABLE dbo.po_items;
IF OBJECT_ID('dbo.purchase_orders', 'U')  IS NOT NULL DROP TABLE dbo.purchase_orders;
IF OBJECT_ID('dbo.schedules', 'U')        IS NOT NULL DROP TABLE dbo.schedules;
IF OBJECT_ID('dbo.dict_supplier', 'U')    IS NOT NULL DROP TABLE dbo.dict_supplier;
IF OBJECT_ID('dbo.dict_hs', 'U')          IS NOT NULL DROP TABLE dbo.dict_hs;
IF OBJECT_ID('dbo.images', 'U')           IS NOT NULL DROP TABLE dbo.images;
IF OBJECT_ID('dbo.materials', 'U')        IS NOT NULL DROP TABLE dbo.materials;
IF OBJECT_ID('dbo.products', 'U')         IS NOT NULL DROP TABLE dbo.products;
IF OBJECT_ID('dbo.customers', 'U')        IS NOT NULL DROP TABLE dbo.customers;
IF OBJECT_ID('dbo.settings', 'U')         IS NOT NULL DROP TABLE dbo.settings;
IF OBJECT_ID('dbo.Users', 'U')            IS NOT NULL DROP TABLE dbo.Users;
GO

-- ============ 身份与权限 ============
CREATE TABLE dbo.Users (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    Username        NVARCHAR(64)  NOT NULL,
    PasswordHash    NVARCHAR(255) NOT NULL,
    DisplayName     NVARCHAR(128) NOT NULL DEFAULT N'',
    Userbqrpower    CHAR(9)       NOT NULL DEFAULT '000000000',
    Usereditpower   CHAR(9)       NOT NULL DEFAULT '000000000',
    IsActive        BIT           NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Users_Username UNIQUE (Username),
    CONSTRAINT CK_Users_Userbqrpower_Binary
        CHECK (Userbqrpower LIKE '[01][01][01][01][01][01][01][01][01]'),
    CONSTRAINT CK_Users_Usereditpower_Binary
        CHECK (Usereditpower LIKE '[01][01][01][01][01][01][01][01][01]')
);
GO

-- 种子 admin (口令 = "admin123",登录后立即改)
INSERT INTO dbo.Users (Username, PasswordHash, DisplayName, Userbqrpower, Usereditpower)
VALUES (N'admin', N'$2a$11$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        N'管理员', '111111111', '111111111');
GO

-- ============ 主数据 ============
CREATE TABLE dbo.customers (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(256) NOT NULL,
    created_at  DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    active      BIT           NOT NULL DEFAULT 1,
    CONSTRAINT UQ_customers_name UNIQUE (name)
);
GO

CREATE TABLE dbo.products (
    code        NVARCHAR(64)  NOT NULL PRIMARY KEY,
    name        NVARCHAR(256) NULL,
    hs_cn       NVARCHAR(64)  NULL,
    hs_id       NVARCHAR(64)  NULL,
    customer    NVARCHAR(256) NULL,
    moldings    NVARCHAR(MAX) NULL,   -- JSON: 排模表
    created_at  DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    active      BIT           NOT NULL DEFAULT 1,
    CONSTRAINT CK_products_moldings_json CHECK (moldings IS NULL OR ISJSON(moldings) = 1)
);
GO

CREATE TABLE dbo.materials (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    product_code        NVARCHAR(64)  NULL,
    item_no             NVARCHAR(64)  NULL,
    name_zh             NVARCHAR(256) NULL,
    name_en             NVARCHAR(256) NULL,
    spec                NVARCHAR(256) NULL,
    category            NVARCHAR(64)  NULL,
    material_code       NVARCHAR(64)  NULL,
    hs_cn               NVARCHAR(64)  NULL,
    hs_id               NVARCHAR(64)  NULL,
    supplier            NVARCHAR(256) NULL,
    customs_company     NVARCHAR(256) NULL,
    unit_kg             NVARCHAR(16)  NOT NULL DEFAULT N'KGM',
    gross_per_pc        DECIMAL(18,6) NOT NULL DEFAULT 0,
    net_per_pc          DECIMAL(18,6) NOT NULL DEFAULT 0,
    length              DECIMAL(18,4) NOT NULL DEFAULT 0,
    width               DECIMAL(18,4) NOT NULL DEFAULT 0,
    height              DECIMAL(18,4) NOT NULL DEFAULT 0,
    qty_per_carton      DECIMAL(18,4) NOT NULL DEFAULT 0,
    weight_per_carton   DECIMAL(18,4) NOT NULL DEFAULT 0,
    image_id            NVARCHAR(64)  NULL,
    active              BIT           NOT NULL DEFAULT 1,
    sort_order          INT           NOT NULL DEFAULT 0,
    created_at          DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_materials_products FOREIGN KEY (product_code)
        REFERENCES dbo.products(code) ON DELETE CASCADE
);
GO
CREATE INDEX IX_materials_product ON dbo.materials(product_code);
CREATE INDEX IX_materials_name    ON dbo.materials(name_zh);
GO

CREATE TABLE dbo.images (
    id          NVARCHAR(64)  NOT NULL PRIMARY KEY,
    mime        NVARCHAR(64)  NULL,
    data_url    NVARCHAR(MAX) NULL,   -- base64 dataURL,大字段
    created_at  DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- ============ 字典 ============
CREATE TABLE dbo.dict_hs (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    keyword     NVARCHAR(128) NOT NULL,
    hs_cn       NVARCHAR(64)  NULL,
    hs_id       NVARCHAR(64)  NULL,
    priority    INT           NOT NULL DEFAULT 100
);
GO
CREATE INDEX IX_dict_hs_keyword ON dbo.dict_hs(keyword);
GO

CREATE TABLE dbo.dict_supplier (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    keyword         NVARCHAR(128) NOT NULL,
    full_name       NVARCHAR(256) NULL,
    customs_company NVARCHAR(256) NULL,
    priority        INT           NOT NULL DEFAULT 100
);
GO
CREATE INDEX IX_dict_supplier_keyword ON dbo.dict_supplier(keyword);
GO

-- ============ 排期 ============
CREATE TABLE dbo.schedules (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    week_label      NVARCHAR(64)  NULL,
    upload_date     DATETIME2(0)  NULL,
    raw_rows        NVARCHAR(MAX) NULL,   -- JSON
    diff_from_prev  NVARCHAR(MAX) NULL,   -- JSON
    created_at      DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_schedules_week_label UNIQUE (week_label),
    CONSTRAINT CK_schedules_raw_rows_json       CHECK (raw_rows IS NULL OR ISJSON(raw_rows) = 1),
    CONSTRAINT CK_schedules_diff_from_prev_json CHECK (diff_from_prev IS NULL OR ISJSON(diff_from_prev) = 1)
);
GO

-- ============ 采购 ============
CREATE TABLE dbo.purchase_orders (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    po_no           NVARCHAR(64)  NULL,
    supplier        NVARCHAR(256) NULL,
    status          NVARCHAR(32)  NOT NULL DEFAULT N'draft',
    order_date      DATE          NULL,
    delivery_date   DATE          NULL,
    notes           NVARCHAR(MAX) NULL,
    created_at      DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_purchase_orders_po_no UNIQUE (po_no)
);
GO

CREATE TABLE dbo.po_items (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    po_id           INT           NOT NULL,
    product_code    NVARCHAR(64)  NULL,
    material_id     INT           NULL,
    qty             DECIMAL(18,4) NULL,
    price           DECIMAL(18,4) NULL,
    currency        NVARCHAR(8)   NOT NULL DEFAULT N'¥',
    notes           NVARCHAR(MAX) NULL,
    tomy_po         NVARCHAR(64)  NULL,   -- 来源排期行的 TOMY PO，用于排期「已下单」精确关联
    ship_unit       NVARCHAR(16)  NULL,
    net_per_pc      DECIMAL(18,6) NULL,
    eta              NVARCHAR(32)  NULL,
    CONSTRAINT FK_po_items_po       FOREIGN KEY (po_id)       REFERENCES dbo.purchase_orders(id) ON DELETE CASCADE,
    CONSTRAINT FK_po_items_material FOREIGN KEY (material_id) REFERENCES dbo.materials(id)
);
GO
CREATE INDEX IX_po_items_po ON dbo.po_items(po_id);
GO

-- ============ 出库 ============
CREATE TABLE dbo.outbound (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    po_no           NVARCHAR(64)  NULL,
    material_id     INT           NULL,
    qty             DECIMAL(18,4) NULL,
    out_date        DATE          NULL,
    notes           NVARCHAR(MAX) NULL,
    created_at      DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_outbound_material FOREIGN KEY (material_id) REFERENCES dbo.materials(id)
);
GO
CREATE INDEX IX_outbound_po_no ON dbo.outbound(po_no);
GO

-- ============ 走货明细 ============
CREATE TABLE dbo.shipments (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    customer        NVARCHAR(256) NULL,
    container_no    NVARCHAR(64)  NULL,
    container_count INT           NOT NULL DEFAULT 1,
    ship_date       DATE          NULL,
    load_date       DATE          NULL,
    bl_no           NVARCHAR(64)  NULL,
    rate            DECIMAL(10,4) NOT NULL DEFAULT 0.93,
    status          NVARCHAR(32)  NOT NULL DEFAULT N'draft',
    created_at      DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.shipment_items (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    shipment_id         INT           NOT NULL,
    material_id         INT           NULL,
    seq                 INT           NULL,
    kg                  DECIMAL(18,4) NULL,
    qty                 DECIMAL(18,4) NULL,
    cartons             INT           NULL,
    qty_per_carton      NVARCHAR(64)  NULL,
    pallet              NVARCHAR(64)  NULL,
    price               DECIMAL(18,4) NULL,
    currency            NVARCHAR(8)   NOT NULL DEFAULT N'¥',
    po_no               NVARCHAR(64)  NULL,
    po_date             DATE          NULL,
    supplier            NVARCHAR(256) NULL,
    customs_company     NVARCHAR(256) NULL,
    bl_head             NVARCHAR(256) NULL,
    contract_no         NVARCHAR(64)  NULL,
    contract_date       DATE          NULL,
    invoice_no          NVARCHAR(64)  NULL,
    invoice_date        DATE          NULL,
    invoice_price       DECIMAL(18,4) NULL,
    product_use         NVARCHAR(256) NULL,
    formula_name        NVARCHAR(256) NULL,
    CONSTRAINT FK_shipment_items_shipment FOREIGN KEY (shipment_id) REFERENCES dbo.shipments(id) ON DELETE CASCADE,
    CONSTRAINT FK_shipment_items_material FOREIGN KEY (material_id) REFERENCES dbo.materials(id)
);
GO
CREATE INDEX IX_shipment_items_shipment ON dbo.shipment_items(shipment_id);
CREATE INDEX IX_shipment_items_po_no    ON dbo.shipment_items(po_no);
GO

-- ============ 设置 ============
CREATE TABLE dbo.settings (
    [key]       NVARCHAR(128) NOT NULL PRIMARY KEY,
    value       NVARCHAR(MAX) NULL,
    updated_at  DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
