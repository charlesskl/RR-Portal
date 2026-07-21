-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalOrderNo" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'received',
    "isMA" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_orders" ("createdAt", "createdBy", "customerName", "deliveryDate", "externalOrderNo", "id", "lastUpdatedBy", "orderDate", "productId", "remark", "status", "updatedAt") SELECT "createdAt", "createdBy", "customerName", "deliveryDate", "externalOrderNo", "id", "lastUpdatedBy", "orderDate", "productId", "remark", "status", "updatedAt" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_externalOrderNo_key" ON "orders"("externalOrderNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 历史数据：旧的草稿/已确认统一并入「已接单」
UPDATE "orders" SET "status" = 'received' WHERE "status" IN ('draft', 'confirmed');
