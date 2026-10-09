-- 133: 仓库位置主数据种子(幂等)。单据表头「仓库」下拉读这张表,空表会导致无法开单。
-- 编号 01-05 为系统内置仓位;名称即单据.仓库 列实际存储的值(历史数据如「来料仓」)。
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [名称] = N'原料仓')
    INSERT INTO [仓库位置]([编号],[名称],[备注]) VALUES(N'01', N'原料仓', N'内置');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [名称] = N'来料仓')
    INSERT INTO [仓库位置]([编号],[名称],[备注]) VALUES(N'02', N'来料仓', N'内置');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [名称] = N'塑胶仓')
    INSERT INTO [仓库位置]([编号],[名称],[备注]) VALUES(N'03', N'塑胶仓', N'内置');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [名称] = N'半成品仓')
    INSERT INTO [仓库位置]([编号],[名称],[备注]) VALUES(N'04', N'半成品仓', N'内置');
IF NOT EXISTS (SELECT 1 FROM [仓库位置] WHERE [名称] = N'成品仓')
    INSERT INTO [仓库位置]([编号],[名称],[备注]) VALUES(N'05', N'成品仓', N'内置');
