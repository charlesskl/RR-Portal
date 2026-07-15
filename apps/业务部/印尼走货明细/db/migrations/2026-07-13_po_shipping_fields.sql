IF COL_LENGTH('dbo.purchase_orders', 'delivery_date') IS NULL
    ALTER TABLE dbo.purchase_orders ADD delivery_date DATE NULL;
GO

IF COL_LENGTH('dbo.po_items', 'ship_unit') IS NULL
    ALTER TABLE dbo.po_items ADD ship_unit NVARCHAR(16) NULL;
GO

IF COL_LENGTH('dbo.po_items', 'net_per_pc') IS NULL
    ALTER TABLE dbo.po_items ADD net_per_pc DECIMAL(18,6) NULL;
GO

IF COL_LENGTH('dbo.po_items', 'eta') IS NULL
    ALTER TABLE dbo.po_items ADD eta NVARCHAR(32) NULL;
GO
