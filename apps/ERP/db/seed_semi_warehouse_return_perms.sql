SET XACT_ABORT ON;
BEGIN TRANSACTION;
;WITH [主体] AS (
    SELECT CONVERT(nvarchar(30), LTRIM(RTRIM([用户]))) AS [用户], MAX(NULLIF([名称],N'')) AS [名称]
    FROM [userbqrpower]
    WHERE NULLIF(LTRIM(RTRIM([用户])),N'') IS NOT NULL
    GROUP BY CONVERT(nvarchar(30), LTRIM(RTRIM([用户])))
    UNION ALL SELECT N'admin', N'admin'
), [去重] AS (
    SELECT [用户], COALESCE(MAX([名称]),[用户]) AS [名称] FROM [主体] GROUP BY [用户]
)
MERGE [userbqrpower] WITH (HOLDLOCK) AS T
USING [去重] AS S ON T.[用户]=S.[用户] AND T.[菜单]=N'半成品退仓'
WHEN MATCHED THEN UPDATE SET T.[单价]=ISNULL(T.[单价],1), T.[金额]=ISNULL(T.[金额],1)
WHEN NOT MATCHED THEN INSERT ([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[审核],[反审核],[单价],[金额])
VALUES(S.[用户],S.[名称],N'半成品退仓',1,1,1,1,1,1,1,1);
COMMIT TRANSACTION;
