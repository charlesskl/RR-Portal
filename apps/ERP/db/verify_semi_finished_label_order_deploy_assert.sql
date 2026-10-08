IF OBJECT_ID(N'[半成品标签单]', N'U') IS NULL
    THROW 51100, N'晚期失败夹具的既有主表被意外删除', 1;

IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NOT NULL
    THROW 51101, N'晚期失败前创建的明细表未回滚', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes AS [i]
    INNER JOIN sys.index_columns AS [ic]
        ON [ic].[object_id] = [i].[object_id]
       AND [ic].[index_id] = [i].[index_id]
    INNER JOIN sys.columns AS [c]
        ON [c].[object_id] = [ic].[object_id]
       AND [c].[column_id] = [ic].[column_id]
    WHERE [i].[object_id] = OBJECT_ID(N'[半成品标签单]')
      AND [i].[name] = N'IX_半成品标签单_日期_ID'
    GROUP BY [i].[index_id]
    HAVING COUNT(*) = 1 AND MAX([c].[name]) = N'ID'
)
    THROW 51102, N'晚期失败回滚未保留夹具的原始错误索引', 1;

RETURN;
