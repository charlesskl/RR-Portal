-- 图片备注: BOM(按款号)/生产单(按生产单号)等模块的图片附件。EF 不迁移·幂等。
-- 文件本体存 wwwroot/uploads/<模块>/<GUID>.<扩展名>, 本表只存元数据与相对路径。

IF OBJECT_ID(N'[图片备注]', N'U') IS NULL
CREATE TABLE [图片备注] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [模块] nvarchar(20) NOT NULL,
    [单号] nvarchar(40) NOT NULL,
    [文件名] nvarchar(200) NULL,
    [存储路径] nvarchar(300) NULL,
    [备注] nvarchar(200) NULL,
    [上传人] nvarchar(20) NULL,
    [上传时间] datetime NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_图片备注_模块单号' AND object_id = OBJECT_ID(N'[图片备注]'))
CREATE INDEX [IX_图片备注_模块单号] ON [图片备注]([模块],[单号]);
