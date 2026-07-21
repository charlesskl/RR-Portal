-- CreateTable
CREATE TABLE "craft_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productNo" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '标准',
    "productName" TEXT NOT NULL,
    "image" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isSpecial" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "craft_template_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "templateId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "craft_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "craft_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "craft_template_parts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "partOrder" INTEGER NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "laborPrice" REAL NOT NULL DEFAULT 0,
    "paintCost" REAL NOT NULL DEFAULT 0,
    "quotedPrice" REAL NOT NULL DEFAULT 0,
    "colorUpcharges" TEXT NOT NULL DEFAULT '[]',
    "dailyTargetQty" INTEGER NOT NULL DEFAULT 0,
    "patternIds" TEXT NOT NULL DEFAULT '[]',
    "remark" TEXT,
    CONSTRAINT "craft_template_parts_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "craft_template_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "craft_templates_productNo_version_key" ON "craft_templates"("productNo", "version");
