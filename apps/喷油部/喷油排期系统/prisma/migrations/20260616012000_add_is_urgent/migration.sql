-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalOrderNo" TEXT NOT NULL,
    "productId" INTEGER,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'received',
    "isMA" BOOLEAN NOT NULL DEFAULT false,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "pendingProduct" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_orders" ("createdAt", "createdBy", "deliveryDate", "externalOrderNo", "id", "isMA", "lastUpdatedBy", "orderDate", "pendingProduct", "productId", "remark", "status", "updatedAt") SELECT "createdAt", "createdBy", "deliveryDate", "externalOrderNo", "id", "isMA", "lastUpdatedBy", "orderDate", "pendingProduct", "productId", "remark", "status", "updatedAt" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_externalOrderNo_key" ON "orders"("externalOrderNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
