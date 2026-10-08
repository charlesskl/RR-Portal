-- 款号物料明细表.工模编号 缺列补丁（fresh 安装顺序问题）：
-- 该列只由 seed_92125_zuru_engineering.sql（最后执行）和未编号的
-- migrate_semi_finished_common_materials.sql（db-init 不枚举）添加，
-- 导致 131_plastic_ear_restore.sql 在全新空库编译报 207 (Invalid column name '工模编号')。
-- 此处补齐；seed 里的 ALTER 有同样守卫，重复执行无副作用。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[款号物料明细表]') AND name=N'工模编号')
    ALTER TABLE [款号物料明细表] ADD [工模编号] nvarchar(100) NULL;
