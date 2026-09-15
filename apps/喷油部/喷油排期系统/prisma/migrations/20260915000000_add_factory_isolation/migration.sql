-- PR #713 多厂区数据隔离：7 张业务表加 factoryId，历史数据全部回填 XINGXIN。
-- 旧代码兼容：旧 EF 模型不引用 factoryId，新增列带默认值不影响旧版读写；
-- orders 复合唯一索引在历史数据全为 XINGXIN 时与原全厂唯一约束行为一致。

ALTER TABLE "users" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';
ALTER TABLE "production_lines" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';
ALTER TABLE "machines" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';
ALTER TABLE "orders" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';
ALTER TABLE "production_plans" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';
ALTER TABLE "inventory_moves" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';
ALTER TABLE "inbound_applications" ADD COLUMN "factoryId" TEXT NOT NULL DEFAULT 'XINGXIN';

-- 订单号改为按厂区唯一
DROP INDEX IF EXISTS "orders_externalOrderNo_key";
CREATE UNIQUE INDEX "orders_factoryId_externalOrderNo_key" ON "orders"("factoryId", "externalOrderNo");

-- prisma @@index([factoryId]) 配套索引
CREATE INDEX "orders_factoryId_idx" ON "orders"("factoryId");
CREATE INDEX "production_lines_factoryId_idx" ON "production_lines"("factoryId");
CREATE INDEX "machines_factoryId_idx" ON "machines"("factoryId");
CREATE INDEX "production_plans_factoryId_idx" ON "production_plans"("factoryId");
CREATE INDEX "inventory_moves_factoryId_idx" ON "inventory_moves"("factoryId");
CREATE INDEX "inbound_applications_factoryId_idx" ON "inbound_applications"("factoryId");
