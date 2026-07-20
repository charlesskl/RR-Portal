IF COL_LENGTH('dbo.po_items','tomy_po') IS NULL
    ALTER TABLE dbo.po_items ADD tomy_po NVARCHAR(64) NULL;
