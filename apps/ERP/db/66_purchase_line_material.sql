-- 采购订单明细加"材料"列(旧系统明细网格列;来源:物料资料.备注 里打包的 "材料:X",前端解析带出)。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[采购明细单]') AND name=N'材料') ALTER TABLE [采购明细单] ADD [材料] nvarchar(40) NULL;
