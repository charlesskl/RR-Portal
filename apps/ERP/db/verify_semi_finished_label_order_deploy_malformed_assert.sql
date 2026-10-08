IF COL_LENGTH(N'[半成品标签单]', N'电脑单号') <> 78
    THROW 51110, N'残缺结构夹具在 migration 失败后被意外修改', 1;

IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NULL
    THROW 51111, N'残缺结构验证意外删除了既有明细表', 1;
