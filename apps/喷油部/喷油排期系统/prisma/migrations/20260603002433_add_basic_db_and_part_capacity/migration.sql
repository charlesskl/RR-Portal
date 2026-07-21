-- CreateTable
CREATE TABLE "production_lines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "workshop" TEXT NOT NULL,
    "leaderName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "machines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "machineNo" TEXT NOT NULL,
    "lineId" INTEGER NOT NULL,
    "machineType" TEXT NOT NULL DEFAULT '移印',
    "isUV" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "machines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_product_parts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "partOrder" INTEGER NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "laborPrice" REAL NOT NULL DEFAULT 0,
    "paintCost" REAL NOT NULL DEFAULT 0,
    "quotedPrice" REAL NOT NULL DEFAULT 0,
    "dailyCapacity" INTEGER NOT NULL DEFAULT 0,
    "productionMode" TEXT NOT NULL DEFAULT 'machine',
    "stdMachineCount" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    CONSTRAINT "product_parts_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "product_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_product_parts" ("id", "itemId", "laborPrice", "paintCost", "partName", "partOrder", "quotedPrice", "remark", "unitCost") SELECT "id", "itemId", "laborPrice", "paintCost", "partName", "partOrder", "quotedPrice", "remark", "unitCost" FROM "product_parts";
DROP TABLE "product_parts";
ALTER TABLE "new_product_parts" RENAME TO "product_parts";
CREATE INDEX "product_parts_itemId_partOrder_idx" ON "product_parts"("itemId", "partOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "machines_machineNo_key" ON "machines"("machineNo");

-- CreateIndex
CREATE INDEX "machines_lineId_idx" ON "machines"("lineId");
