-- 为现有账号及权限主体增量补齐 来料标签查询 权限，不改写已有设置。
-- 来料标签查询(报表)改用独立权限菜单(原挂 采购入仓单 权限),查询页只读,仅授 打开/打印。
SET XACT_ABORT ON;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @锁结果 int;
    EXEC @锁结果 = sys.sp_getapplock
        @Resource = N'db.seed_material_label_query_perms',
        @LockMode = N'Exclusive',
        @LockOwner = N'Transaction',
        @LockTimeout = 60000;

    IF @锁结果 < 0
        THROW 51001, N'无法取得来料标签查询权限种子锁', 1;

    -- userbqrpower.用户 是 nvarchar(30)。无法无损写入的主体一律跳过，绝不截断后授权。
    DECLARE @跳过账号数 int;
    SELECT @跳过账号数 = COUNT(*)
    FROM [sysfileuser]
    CROSS APPLY (VALUES (CONVERT(nvarchar(max), LTRIM(RTRIM([用户]))))) AS [规范化]([用户])
    WHERE NULLIF([规范化].[用户], N'') IS NOT NULL
      AND DATALENGTH([规范化].[用户]) > 60;

    IF @跳过账号数 > 0
        PRINT CONCAT(N'来料标签查询权限种子：跳过 ', @跳过账号数,
                     N' 个无法无损写入 userbqrpower.用户 nvarchar(30) 的账号；未进行截断授权。');

;WITH [权限主体来源] AS (
    SELECT CONVERT(nvarchar(30), [规范化].[用户]) AS [用户], CAST(NULL AS nvarchar(40)) AS [名称]
    FROM [sysfileuser]
    CROSS APPLY (VALUES (CONVERT(nvarchar(max), LTRIM(RTRIM([用户]))))) AS [规范化]([用户])
    WHERE NULLIF([规范化].[用户], N'') IS NOT NULL
      AND DATALENGTH([规范化].[用户]) <= 60

    UNION ALL

    SELECT LTRIM(RTRIM([用户])) AS [用户], [名称]
    FROM [userbqrpower]
    WHERE NULLIF(LTRIM(RTRIM([用户])), N'') IS NOT NULL

    UNION ALL

    SELECT N'admin', N'admin'
),
[权限主体] AS (
    SELECT [用户], COALESCE(MAX(NULLIF([名称], N'')), [用户]) AS [名称]
    FROM [权限主体来源]
    GROUP BY [用户]
)
MERGE [userbqrpower] WITH (HOLDLOCK) AS [目标]
USING [权限主体] AS [来源]
   ON [目标].[用户] = [来源].[用户]
  AND [目标].[菜单] = N'来料标签查询'
WHEN NOT MATCHED BY TARGET THEN
    INSERT ([用户], [名称], [菜单], [打开], [打印])
    VALUES ([来源].[用户], [来源].[名称], N'来料标签查询', 1, 1);

IF EXISTS (
    SELECT 1
    FROM [userbqrpower]
    WHERE [菜单] = N'来料标签查询'
    GROUP BY [用户], [菜单]
    HAVING COUNT(*) > 1
)
    THROW 51002, N'来料标签查询权限存在重复主体', 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
