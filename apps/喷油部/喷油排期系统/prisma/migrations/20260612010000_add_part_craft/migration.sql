-- 部位(product_parts) 加「工序/工艺」字段：手喷 / 移印 / 自动喷 / UV（部位级，存量行默认空串）
ALTER TABLE "product_parts" ADD COLUMN "craft" TEXT NOT NULL DEFAULT '';
