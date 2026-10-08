-- BOM 按 PO 号绑定：同一货号不同 PO 号(=合同号)可能物料不同,BOM(款号物料总表/明细表,业务键=款号)
-- 要能绑定多个 PO 号。绑定时机：从排期跳转建 BOM 的,保存时台头带 待绑定PO号,审核后自动绑定；
-- 生产通知单创建时 货号行 BOM款号 + 单头合同号 自动绑定。幂等(可重跑)。
SET XACT_ABORT ON;

-- 1) 新表 款号物料PO绑定：款号 × PO号 唯一。无 FK(应用层保证)。
IF OBJECT_ID(N'款号物料PO绑定', N'U') IS NULL
BEGIN
    CREATE TABLE [款号物料PO绑定](
        [ID] int IDENTITY(1,1) PRIMARY KEY,
        [款号] nvarchar(50) NOT NULL,
        [PO号] nvarchar(50) NOT NULL,
        [绑定时间] datetime NOT NULL CONSTRAINT [DF_款号物料PO绑定_绑定时间] DEFAULT(GETDATE())
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UQ_款号物料PO绑定_款号_PO号')
BEGIN
    ALTER TABLE [款号物料PO绑定] ADD CONSTRAINT [UQ_款号物料PO绑定_款号_PO号] UNIQUE([款号],[PO号]);
END;
GO

-- 2) 款号物料总表 加 待绑定PO号（从排期跳转建 BOM 时带入,审核成功后自动绑定并清空）
IF COL_LENGTH(N'款号物料总表', N'待绑定PO号') IS NULL
BEGIN
    ALTER TABLE [款号物料总表] ADD [待绑定PO号] nvarchar(50) NULL;
END;
GO
