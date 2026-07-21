-- DropIndex
DROP INDEX "order_line_qtys_orderLineId_idx";

-- DropIndex
DROP INDEX "order_part_upcharges_orderLineId_idx";

-- DropIndex
DROP INDEX "order_specs_orderId_specOrder_idx";

-- DropIndex
DROP INDEX "product_item_colors_itemId_colorOrder_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "order_line_qtys";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "order_part_upcharges";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "order_specs";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "product_item_colors";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "order_part_qtys" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderLineId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "sourcePartId" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "partOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_part_qtys_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_order_lines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "sourceItemId" INTEGER,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_order_lines" ("id", "itemName", "lineOrder", "orderId", "sourceItemId") SELECT "id", "itemName", "lineOrder", "orderId", "sourceItemId" FROM "order_lines";
DROP TABLE "order_lines";
ALTER TABLE "new_order_lines" RENAME TO "order_lines";
CREATE INDEX "order_lines_orderId_lineOrder_idx" ON "order_lines"("orderId", "lineOrder");
CREATE TABLE "new_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalOrderNo" TEXT NOT NULL,
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
INSERT INTO "new_orders" ("createdAt", "createdBy", "deliveryDate", "externalOrderNo", "id", "isMA", "lastUpdatedBy", "orderDate", "productId", "remark", "status", "updatedAt") SELECT "createdAt", "createdBy", "deliveryDate", "externalOrderNo", "id", "isMA", "lastUpdatedBy", "orderDate", "productId", "remark", "status", "updatedAt" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_externalOrderNo_key" ON "orders"("externalOrderNo");
CREATE TABLE "new_products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productNo" TEXT NOT NULL,
    "iterationNo" TEXT NOT NULL DEFAULT 'V1',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effectiveDate" DATETIME,
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_products" ("createdAt", "createdBy", "effectiveDate", "id", "iterationNo", "lastUpdatedBy", "productNo", "remark", "status", "updatedAt") SELECT "createdAt", "createdBy", "effectiveDate", "id", "iterationNo", "lastUpdatedBy", "productNo", "remark", "status", "updatedAt" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE UNIQUE INDEX "products_productNo_key" ON "products"("productNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "order_part_qtys_orderLineId_idx" ON "order_part_qtys"("orderLineId");
