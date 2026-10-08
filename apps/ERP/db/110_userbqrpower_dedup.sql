-- userbqrpower 同 用户+菜单 重复行去重(权限改名迁移 106/107/108 与既有授权行碰撞产生)。
-- 同键多行按位取 MAX 合并(任一位曾为 true 即保留 true),仅保留一行。幂等。
SET XACT_ABORT ON;
BEGIN TRAN;

-- 1) 位合并:同 用户+菜单 组内取 MAX 回写到该组所有行(使各行一致,删谁都安全)
UPDATE t SET
    [打开]=m.[打开],[保存]=m.[保存],[删除]=m.[删除],[打印]=m.[打印],[单价]=m.[单价],
    [金额]=m.[金额],[审核]=m.[审核],[反审核]=m.[反审核],[功能]=m.[功能]
FROM [userbqrpower] t
JOIN (
    SELECT [用户],[菜单],
        MAX(CAST([打开] AS tinyint)) [打开], MAX(CAST([保存] AS tinyint)) [保存],
        MAX(CAST([删除] AS tinyint)) [删除], MAX(CAST([打印] AS tinyint)) [打印],
        MAX(CAST([单价] AS tinyint)) [单价], MAX(CAST([金额] AS tinyint)) [金额],
        MAX(CAST([审核] AS tinyint)) [审核], MAX(CAST([反审核] AS tinyint)) [反审核],
        MAX(CAST([功能] AS tinyint)) [功能]
    FROM [userbqrpower]
    GROUP BY [用户],[菜单] HAVING COUNT(*)>1
) m ON m.[用户]=t.[用户] AND m.[菜单]=t.[菜单];

-- 2) 去重:同 用户+菜单 只留一行
WITH d AS (
    SELECT ROW_NUMBER() OVER (PARTITION BY [用户],[菜单] ORDER BY (SELECT NULL)) rn
    FROM [userbqrpower]
)
DELETE FROM d WHERE rn > 1;

COMMIT;
