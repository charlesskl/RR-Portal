-- CreateTable
CREATE TABLE "production_plans" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "planDate" DATETIME NOT NULL,
    "planType" TEXT NOT NULL DEFAULT 'daily',
    "lineId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "sourcePartId" INTEGER,
    "machineNos" TEXT NOT NULL DEFAULT '[]',
    "plannedQty" INTEGER NOT NULL,
    "workerCount" INTEGER NOT NULL DEFAULT 1,
    "goodQty" INTEGER,
    "defectQty" INTEGER NOT NULL DEFAULT 0,
    "workHours" REAL NOT NULL DEFAULT 11,
    "productionValue" REAL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastModifiedBy" TEXT,
    "lastModifiedAt" DATETIME NOT NULL,
    "modificationHistory" TEXT NOT NULL DEFAULT '[]',
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    CONSTRAINT "production_plans_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "production_plans_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "production_plans_planDate_lineId_idx" ON "production_plans"("planDate", "lineId");

-- CreateIndex
CREATE INDEX "production_plans_orderId_idx" ON "production_plans"("orderId");
