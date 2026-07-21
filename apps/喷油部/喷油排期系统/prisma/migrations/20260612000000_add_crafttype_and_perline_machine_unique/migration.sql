-- 拉别加「工艺类型」字段（手喷/移印/自动喷/UV），存量行默认「移印」
ALTER TABLE "production_lines" ADD COLUMN "craftType" TEXT NOT NULL DEFAULT '移印';

-- 机台号唯一规则：从「全厂唯一」改为「同一拉别内唯一」
-- 先删旧的全厂唯一索引
DROP INDEX "machines_machineNo_key";
-- 再建按拉别复合唯一索引（A拉的5#与C拉的5#视为两台不同机器）
CREATE UNIQUE INDEX "machines_lineId_machineNo_key" ON "machines"("lineId", "machineNo");
