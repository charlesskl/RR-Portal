-- 核价库由“产品 -> 子件 -> 部位”改为“产品 -> 部位”，订单同步取消订单子件行。
-- 保留原部位、数量主键，避免已有排期的 sourcePartId 失效。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_product_parts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "partGroupId" INTEGER NOT NULL DEFAULT 0,
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
    "isTumbler" BOOLEAN NOT NULL DEFAULT false,
    "craftPasses" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    CONSTRAINT "product_parts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_product_parts" (
    "id", "productId", "partGroupId", "partName", "partOrder", "unitCost", "laborPrice",
    "paintCost", "quotedPrice", "craft", "craftDetail", "dailyCapacity", "productionMode",
    "stdMachineCount", "isTumbler", "craftPasses", "remark"
)
SELECT
    part."id", item."productId", part."partGroupId", part."partName", part."partOrder",
    part."unitCost", part."laborPrice", part."paintCost", part."quotedPrice", part."craft",
    part."craftDetail", part."dailyCapacity", part."productionMode", part."stdMachineCount",
    part."isTumbler", part."craftPasses", part."remark"
FROM "product_parts" AS part
INNER JOIN "product_items" AS item ON item."id" = part."itemId";

DROP TABLE "product_parts";
DROP TABLE "product_items";
ALTER TABLE "new_product_parts" RENAME TO "product_parts";
CREATE INDEX "product_parts_productId_partOrder_idx" ON "product_parts"("productId", "partOrder");
CREATE INDEX "product_parts_productId_partGroupId_idx" ON "product_parts"("productId", "partGroupId");

CREATE TABLE "new_order_part_qtys" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "sourcePartId" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "partOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "order_part_qtys_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_order_part_qtys" ("id", "orderId", "partName", "sourcePartId", "qty", "partOrder")
SELECT qty."id", line."orderId", qty."partName", qty."sourcePartId", qty."qty", qty."partOrder"
FROM "order_part_qtys" AS qty
INNER JOIN "order_lines" AS line ON line."id" = qty."orderLineId";

DROP TABLE "order_part_qtys";
DROP TABLE "order_lines";
ALTER TABLE "new_order_part_qtys" RENAME TO "order_part_qtys";
CREATE INDEX "order_part_qtys_orderId_partOrder_idx" ON "order_part_qtys"("orderId", "partOrder");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
