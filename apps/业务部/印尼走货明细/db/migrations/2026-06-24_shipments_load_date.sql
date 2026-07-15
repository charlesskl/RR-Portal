-- 走货明细新增「装柜时间」load_date
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.shipments') AND name = 'load_date')
BEGIN
    ALTER TABLE dbo.shipments ADD load_date DATE NULL;
END
GO
