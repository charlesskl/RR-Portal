-- 放开 BOM 物料外键(方案 C,用户拍板):BOM 允许混合 来料+塑胶 物料。
-- 说明:不改 db/02 历史重建脚本(该脚本重建库时仍会加回 FK,如需彻底一致请另行同步);
-- 引用完整性改由应用层校验兜底(StyleService.ReplaceMaterialsAsync:物料编号须存在于 物料资料 或 塑胶物料资料)。
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_133_查找' AND parent_object_id = OBJECT_ID(N'[款号物料明细表]'))
    ALTER TABLE [款号物料明细表] DROP CONSTRAINT [FK_133_查找];
-- 同一链路:生产BOM物料清单(制单展开快照).物料编号 也有同指向 FK,混合物料制单会撞,一并放开。
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_140_查找' AND parent_object_id = OBJECT_ID(N'[生产BOM物料清单]'))
    ALTER TABLE [生产BOM物料清单] DROP CONSTRAINT [FK_140_查找];
