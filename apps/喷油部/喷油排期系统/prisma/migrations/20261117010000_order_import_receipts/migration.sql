CREATE TABLE IF NOT EXISTS order_import_receipts (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL, factoryId TEXT NOT NULL DEFAULT 'XINGXIN', sourceFactoryId TEXT,
  acceptedQty BIGINT NOT NULL DEFAULT 0, details TEXT NOT NULL DEFAULT '[]', pendingDetails INTEGER NOT NULL DEFAULT 0,
  pdfToken TEXT NOT NULL DEFAULT '', createdBy TEXT NOT NULL, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL,
  FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS order_import_receipts_factoryId_orderId_idx ON order_import_receipts(factoryId,orderId);
