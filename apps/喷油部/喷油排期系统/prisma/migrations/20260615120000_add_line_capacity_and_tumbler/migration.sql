-- 拉别加「日产能上限」(件，0=不卡)；部位加「炒货机」标识
ALTER TABLE "production_lines" ADD COLUMN "dailyCapacityLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_parts" ADD COLUMN "isTumbler" BOOLEAN NOT NULL DEFAULT false;
