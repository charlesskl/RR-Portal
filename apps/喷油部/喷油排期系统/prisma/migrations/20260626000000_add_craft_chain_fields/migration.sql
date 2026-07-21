-- AlterTable: 工序链字段
ALTER TABLE "product_parts" ADD COLUMN "craftPasses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "production_plans" ADD COLUMN "stepNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "production_plans" ADD COLUMN "craft" TEXT NOT NULL DEFAULT '';
