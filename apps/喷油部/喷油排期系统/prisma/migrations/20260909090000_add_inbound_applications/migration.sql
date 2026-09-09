-- CreateTable
CREATE TABLE "inbound_applications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "applicationNo" TEXT NOT NULL,
    "sourcePlanId" INTEGER NOT NULL,
    "productionDate" DATETIME NOT NULL,
    "orderNo" TEXT NOT NULL,
    "productNo" TEXT NOT NULL,
    "itemName" TEXT NOT NULL DEFAULT '',
    "partName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_applications_applicationNo_key" ON "inbound_applications"("applicationNo");
CREATE INDEX "inbound_applications_createdAt_idx" ON "inbound_applications"("createdAt");
CREATE INDEX "inbound_applications_orderNo_idx" ON "inbound_applications"("orderNo");
CREATE INDEX "inbound_applications_productNo_idx" ON "inbound_applications"("productNo");
