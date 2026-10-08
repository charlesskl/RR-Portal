-- 塑胶物料资料.物料编号 唯一性约束(对齐 物料资料.UQ_物料资料_物料编号,见 db/02_rebuild_relations.sql)。
-- 背景:物料编号要求全局唯一不可重复;物料资料早有唯一约束,塑胶物料资料缺,本脚本补齐。
-- 重复预防以应用层校验钩子(PlasticMaterialController.ValidateForSaveAsync)给中文提示,本索引做并发兜底。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_塑胶物料资料_物料编号' AND object_id = OBJECT_ID(N'[塑胶物料资料]'))
    CREATE UNIQUE INDEX [UX_塑胶物料资料_物料编号] ON [塑胶物料资料]([物料编号]);
