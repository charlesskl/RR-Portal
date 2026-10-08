DROP TABLE [半成品标签明细];
DROP INDEX [IX_半成品标签单_日期_ID] ON [半成品标签单];
CREATE INDEX [IX_半成品标签单_日期_ID] ON [半成品标签单]([ID]);
