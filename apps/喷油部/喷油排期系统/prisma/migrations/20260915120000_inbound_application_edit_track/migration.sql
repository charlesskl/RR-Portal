-- 入库申请单支持编辑 + ERP 增量重拉：
-- 新增 updatedAt/updatedBy，updatedAt 回填为 createdAt，
-- 此后 ERP 增量拉取口径从 createdAt 改为 updatedAt（编辑即重新出现在增量里）。

ALTER TABLE "inbound_applications" ADD COLUMN "updatedAt" DATETIME NULL;
ALTER TABLE "inbound_applications" ADD COLUMN "updatedBy" TEXT NULL;

UPDATE "inbound_applications" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

CREATE INDEX "inbound_applications_updatedAt_idx" ON "inbound_applications"("updatedAt");
