-- CreateTable
CREATE TABLE "orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalOrderNo" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_specs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "specName" TEXT NOT NULL,
    "specOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_specs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sourceItemId" INTEGER,
    "sourceColorId" INTEGER,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_line_qtys" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderLineId" INTEGER NOT NULL,
    "specName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_line_qtys_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_part_upcharges" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderLineId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "sourcePartId" INTEGER,
    "specialUpcharge" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "order_part_upcharges_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_externalOrderNo_key" ON "orders"("externalOrderNo");

-- CreateIndex
CREATE INDEX "order_specs_orderId_specOrder_idx" ON "order_specs"("orderId", "specOrder");

-- CreateIndex
CREATE INDEX "order_lines_orderId_lineOrder_idx" ON "order_lines"("orderId", "lineOrder");

-- CreateIndex
CREATE INDEX "order_line_qtys_orderLineId_idx" ON "order_line_qtys"("orderLineId");

-- CreateIndex
CREATE INDEX "order_part_upcharges_orderLineId_idx" ON "order_part_upcharges"("orderLineId");
