-- 原料出库联动生产单:明细行加 生产单号(指向 生产制单.生产单号,与既有 啤机生产单号 并存、语义不同)。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'原料出库明细单') AND name=N'生产单号')
    ALTER TABLE [原料出库明细单] ADD [生产单号] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_原料出库明细单_生产单号')
    CREATE INDEX [IX_原料出库明细单_生产单号] ON [原料出库明细单]([生产单号]);
