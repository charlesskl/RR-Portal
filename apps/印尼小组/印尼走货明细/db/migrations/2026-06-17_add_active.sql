IF COL_LENGTH('dbo.products','active') IS NULL
    ALTER TABLE dbo.products ADD active BIT NOT NULL CONSTRAINT DF_products_active DEFAULT 1;
IF COL_LENGTH('dbo.customers','active') IS NULL
    ALTER TABLE dbo.customers ADD active BIT NOT NULL CONSTRAINT DF_customers_active DEFAULT 1;
