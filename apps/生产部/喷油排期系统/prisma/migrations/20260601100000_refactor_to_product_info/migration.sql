-- DropIndex
DROP INDEX IF EXISTS "craft_template_items_templateId_itemOrder_idx";

-- DropIndex
DROP INDEX IF EXISTS "craft_template_parts_itemId_partOrder_idx";

-- DropIndex
DROP INDEX IF EXISTS "craft_templates_productNo_version_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "craft_template_parts";
DROP TABLE IF EXISTS "craft_template_items";
DROP TABLE IF EXISTS "craft_templates";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productNo" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "specName" TEXT NOT NULL DEFAULT '标准',
    "iterationNo" TEXT NOT NULL DEFAULT 'V1',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effectiveDate" DATETIME,
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "product_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_item_colors" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "colorName" TEXT NOT NULL,
    "colorOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_item_colors_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "product_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_parts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "partOrder" INTEGER NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "laborPrice" REAL NOT NULL DEFAULT 0,
    "paintCost" REAL NOT NULL DEFAULT 0,
    "quotedPrice" REAL NOT NULL DEFAULT 0,
    "remark" TEXT,
    CONSTRAINT "product_parts_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "product_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "products_productNo_specName_key" ON "products"("productNo", "specName");

-- CreateIndex
CREATE INDEX "product_items_productId_itemOrder_idx" ON "product_items"("productId", "itemOrder");

-- CreateIndex
CREATE INDEX "product_item_colors_itemId_colorOrder_idx" ON "product_item_colors"("itemId", "colorOrder");

-- CreateIndex
CREATE INDEX "product_parts_itemId_partOrder_idx" ON "product_parts"("itemId", "partOrder");
