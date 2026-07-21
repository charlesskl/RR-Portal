-- CreateTable
CREATE TABLE "inventory_moves" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "ownerOrderId" INTEGER,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refOrderId" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_machines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "machineNo" TEXT NOT NULL,
    "lineId" INTEGER NOT NULL,
    "machineType" TEXT NOT NULL DEFAULT '移印',
    "isUV" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "equipmentKind" TEXT NOT NULL DEFAULT '普通',
    CONSTRAINT "machines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_machines" ("id", "isActive", "isUV", "lineId", "machineNo", "machineType") SELECT "id", "isActive", "isUV", "lineId", "machineNo", "machineType" FROM "machines";
DROP TABLE "machines";
ALTER TABLE "new_machines" RENAME TO "machines";
CREATE INDEX "machines_lineId_idx" ON "machines"("lineId");
CREATE UNIQUE INDEX "machines_lineId_machineNo_key" ON "machines"("lineId", "machineNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "inventory_moves_productId_itemName_partName_idx" ON "inventory_moves"("productId", "itemName", "partName");

-- CreateIndex
CREATE INDEX "inventory_moves_ownerOrderId_idx" ON "inventory_moves"("ownerOrderId");

-- CreateIndex
CREATE INDEX "inventory_moves_refOrderId_idx" ON "inventory_moves"("refOrderId");
