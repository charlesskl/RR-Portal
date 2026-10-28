CREATE TABLE IF NOT EXISTS "order_materials" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN',
  "orderId" INTEGER NOT NULL,
  "partName" TEXT NOT NULL,
  "arrivedQty" INTEGER NOT NULL DEFAULT 0,
  "expectedDate" BIGINT,
  "actualDate" BIGINT,
  "remark" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "autoScheduleEnabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" BIGINT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "lastReflowDate" BIGINT,
  "configuration" TEXT NOT NULL DEFAULT '[]',
  "history" TEXT NOT NULL DEFAULT '[]',
  CONSTRAINT "order_materials_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "order_materials_factoryId_orderId_partName_key" ON "order_materials"("factoryId", "orderId", "partName");
