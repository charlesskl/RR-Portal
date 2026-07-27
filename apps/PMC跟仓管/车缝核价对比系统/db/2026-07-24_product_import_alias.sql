SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.product_import_alias', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.product_import_alias
    (
        alias_id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_import_alias PRIMARY KEY,
        product_code   NVARCHAR(50) NOT NULL,
        external_name  NVARCHAR(200) NOT NULL,
        product_id     INT NOT NULL,
        created_by     INT NULL,
        created_at     DATETIME2 NOT NULL CONSTRAINT DF_product_import_alias_created_at DEFAULT SYSUTCDATETIME(),
        updated_by     INT NULL,
        updated_at     DATETIME2 NULL,
        CONSTRAINT FK_product_import_alias_product FOREIGN KEY(product_id) REFERENCES dbo.product(product_id),
        CONSTRAINT UX_product_import_alias_name UNIQUE(product_code, external_name)
    );
END;
