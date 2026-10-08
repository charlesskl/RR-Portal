-- 修复排产(paiji)同步的塑胶入仓明细:此前 PaijiMapper.ToReceiptLine 把 物料编号 落成了货号(mold_no)、
-- 物料名称 落成了模具编号(part_name)、工模编号 缺失,导致采购订单核销(生产单号+物料+颜色)匹配不上,
-- 塑胶库存也挂在货号之下。
-- 修复口径:工模编号=旧物料名称(即模具编号);物料编号/物料名称按 生产单号+模具编号+颜色 对齐塑胶采购订单明细;
-- 同模具同颜色有多条采购行(左右耳朵等)时,按 ID 顺序与入仓行一一对应轮转。匹配不到的行不动,可重复执行。
WITH rr AS (
    SELECT ID, 生产单号, 物料名称 AS 模具编号, ISNULL(颜色,'') AS 颜色,
           ROW_NUMBER() OVER (PARTITION BY 生产单号, 物料名称, ISNULL(颜色,'') ORDER BY ID) AS rn
    FROM [dbo].[塑胶入仓明细单]
    WHERE [备注] LIKE N'排产#%' AND [工模编号] IS NULL
),
pp AS (
    SELECT d.生产单号, d.模具编号, ISNULL(d.颜色,'') AS 颜色, d.物料编号, d.物料名称,
           ROW_NUMBER() OVER (PARTITION BY d.生产单号, d.模具编号, ISNULL(d.颜色,'') ORDER BY d.ID) AS rn,
           COUNT(*) OVER (PARTITION BY d.生产单号, d.模具编号, ISNULL(d.颜色,'')) AS cnt
    FROM [dbo].[塑胶采购订单明细] d
)
UPDATE r SET [工模编号]=r.[物料名称], [物料编号]=pp.[物料编号], [物料名称]=pp.[物料名称]
FROM [dbo].[塑胶入仓明细单] r
JOIN rr ON rr.ID = r.ID
JOIN pp ON pp.[生产单号]=rr.[生产单号] AND pp.[模具编号]=rr.[模具编号] AND pp.[颜色]=rr.[颜色]
       AND pp.rn = ((rr.rn-1) % pp.cnt) + 1;
GO
