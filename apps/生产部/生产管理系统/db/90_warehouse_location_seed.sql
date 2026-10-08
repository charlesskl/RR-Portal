-- 仓库位置(仓库主数据)初始化:六个标准仓库,供单据表头「仓库」下拉选择。幂等(按编号判断)。
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [编号]=N'01') INSERT INTO [仓库位置]([编号],[名称]) VALUES(N'01',N'来料仓');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [编号]=N'02') INSERT INTO [仓库位置]([编号],[名称]) VALUES(N'02',N'塑胶仓');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [编号]=N'03') INSERT INTO [仓库位置]([编号],[名称]) VALUES(N'03',N'半成品仓');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [编号]=N'04') INSERT INTO [仓库位置]([编号],[名称]) VALUES(N'04',N'成品仓');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [编号]=N'05') INSERT INTO [仓库位置]([编号],[名称]) VALUES(N'05',N'原料仓');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [编号]=N'06') INSERT INTO [仓库位置]([编号],[名称]) VALUES(N'06',N'辅料仓');
GO
