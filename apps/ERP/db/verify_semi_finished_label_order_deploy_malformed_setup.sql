ALTER TABLE [半成品标签单] DROP CONSTRAINT [UQ_半成品标签单_电脑单号];
ALTER TABLE [半成品标签单] ALTER COLUMN [电脑单号] nvarchar(39) NOT NULL;
