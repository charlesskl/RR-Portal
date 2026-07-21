-- CreateTable
CREATE TABLE "craft_aliases" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "craft" TEXT NOT NULL DEFAULT '',
    "craftDetail" TEXT NOT NULL DEFAULT '',
    "dailyCapacity" INTEGER NOT NULL DEFAULT 0,
    "productionMode" TEXT NOT NULL DEFAULT 'machine',
    "stdMachineCount" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    CONSTRAINT "product_parts_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "product_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_product_parts" ("craft", "dailyCapacity", "id", "itemId", "laborPrice", "paintCost", "partName", "partOrder", "productionMode", "quotedPrice", "remark", "stdMachineCount", "unitCost") SELECT "craft", "dailyCapacity", "id", "itemId", "laborPrice", "paintCost", "partName", "partOrder", "productionMode", "quotedPrice", "remark", "stdMachineCount", "unitCost" FROM "product_parts";
DROP TABLE "product_parts";
ALTER TABLE "new_product_parts" RENAME TO "product_parts";
CREATE INDEX "product_parts_itemId_partOrder_idx" ON "product_parts"("itemId", "partOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "craft_aliases_alias_key" ON "craft_aliases"("alias");
