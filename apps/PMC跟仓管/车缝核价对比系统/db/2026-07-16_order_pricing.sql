/* 第一期 · 订单级核价与验货入库主干（幂等升级） */
USE [StitchCostPro];
GO

/* 外发价允许为空：空值代表订单待核价。 */
IF OBJECT_ID(N'dbo.purchase_order_line', N'U') IS NOT NULL
BEGIN
    ALTER TABLE dbo.purchase_order_line ALTER COLUMN outsource_price_excl DECIMAL(14,4) NULL;
END
GO

/* 品质记录精确关联订单工序，并以验货后入库数作为进度唯一来源。 */
IF COL_LENGTH(N'dbo.quality_inspection', N'line_id') IS NULL
    ALTER TABLE dbo.quality_inspection ADD line_id INT NULL;
GO
IF COL_LENGTH(N'dbo.quality_inspection', N'stock_in_qty') IS NULL
    ALTER TABLE dbo.quality_inspection ADD stock_in_qty DECIMAL(14,2) NULL;
GO
IF COL_LENGTH(N'dbo.quality_inspection', N'stock_in_qty') IS NOT NULL
    UPDATE dbo.quality_inspection SET stock_in_qty = received_qty WHERE stock_in_qty IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_qi_line')
    ALTER TABLE dbo.quality_inspection ADD CONSTRAINT FK_qi_line
        FOREIGN KEY (line_id) REFERENCES dbo.purchase_order_line(line_id);
GO

/* 订单外发价首次录入和每次修改均保留历史。 */
IF OBJECT_ID(N'dbo.order_price_history', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.order_price_history (
        history_id       INT IDENTITY(1,1) NOT NULL,
        line_id          INT NOT NULL,
        old_price_excl   DECIMAL(14,4) NULL,
        new_price_excl   DECIMAL(14,4) NOT NULL,
        change_reason    NVARCHAR(300) NULL,
        changed_by       INT NULL,
        changed_at       DATETIME2 NOT NULL CONSTRAINT DF_oph_changed DEFAULT(SYSDATETIME()),
        CONSTRAINT PK_order_price_history PRIMARY KEY (history_id),
        CONSTRAINT FK_oph_line FOREIGN KEY (line_id) REFERENCES dbo.purchase_order_line(line_id),
        CONSTRAINT FK_oph_user FOREIGN KEY (changed_by) REFERENCES dbo.sys_user(user_id)
    );
    CREATE INDEX IX_oph_line_time ON dbo.order_price_history(line_id, changed_at DESC);
END
GO

/* 现有订单行价格作为已确认的首条历史保留；现有订单状态不回退。 */
INSERT INTO dbo.order_price_history(line_id, old_price_excl, new_price_excl, change_reason, changed_by, changed_at)
SELECT l.line_id, NULL, l.outsource_price_excl, N'历史订单价格迁移', o.created_by, COALESCE(o.created_at, SYSDATETIME())
FROM dbo.purchase_order_line l
JOIN dbo.purchase_order o ON o.order_id = l.order_id
WHERE l.outsource_price_excl IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.order_price_history h WHERE h.line_id = l.line_id);
GO

PRINT N'====== 订单级核价 / 价格历史 / 验货入库字段升级完成 ======';
GO
