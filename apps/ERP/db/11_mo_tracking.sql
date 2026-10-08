-- 生产通知单 · MO单跟踪表（MO单录入页签）。幂等(可重跑)：建表 + 生产单号索引。不加 FK(应用层保证)。
IF OBJECT_ID(N'生产通知单MO单', N'U') IS NULL
CREATE TABLE [生产通知单MO单](
  [ID] bigint IDENTITY(1,1) PRIMARY KEY,
  [生产单号] nvarchar(30) NOT NULL,
  [序号] int NULL,
  [接单日期] datetime2(0) NULL,
  [正单合同号] nvarchar(40) NULL,
  [产品货号] nvarchar(40) NULL,
  [产品名称] nvarchar(60) NULL,
  [接单数量] decimal(18,4) NULL,
  [装箱方式] nvarchar(20) NULL,
  [订单总箱数] int NULL,
  [验货日期] datetime2(0) NULL,
  [备注] nvarchar(200) NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产通知单MO单_生产单号')
CREATE INDEX [IX_生产通知单MO单_生产单号] ON [生产通知单MO单]([生产单号]);
