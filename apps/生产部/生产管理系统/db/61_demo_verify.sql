-- ============================================================================
-- 61_demo_verify.sql — DEMO 数据链路验证（只读 SELECT 断言，不写任何数据）
-- 前提：已执行 db/60_demo_virtual_data.sql。每行输出 检查项 + PASS/FAIL，结尾输出总计。
-- 说明：本脚本只验证"数据落库口径"。以下逻辑在 API/service 层，SQL 无法直接断言，
--       已在对应检查项注释标明，需经界面/API 复核：
--   - 塑胶共用物料表"套数=出模数÷用量"保存校验（塑胶共用物料校验.校验套数）
--   - 塑胶共用物料表.工模编号 保存时存在性校验（反例：填不存在的工模编号应被 API 拒绝）
--   - 二次加工 BD/AF/AH 字母推导（电镀=B、印喷=D → BD；在 PlasticProcessPurchaseOrder 链路）
--   - 半成品共用物料设置.库存单价HK 自动计算（StyleService 保存时；本脚本数据留 NULL 待算）
--   - SemiBomExpander 递归展开/环保护/重复扣料警告（引擎层，已用快照行侧面印证）
--   - 盘点审核回写（MaterialStocktakeService.ApproveAsync 事务；60 脚本已按同口径 UPDATE 模拟）
-- ============================================================================
SET NOCOUNT ON;

DECLARE @结果 TABLE ([序号] int NOT NULL, [检查项] nvarchar(200) NOT NULL, [结果] nvarchar(4) NOT NULL);

-- 01 类别树：父级 DEMO-CAT 与两个子级（类别=父编号）都能按编号查到
INSERT INTO @结果
SELECT 1, N'类别树：父子类别按编号可查（物料类别.类别=父级编号）',
       CASE WHEN EXISTS (SELECT 1 FROM [物料类别] WHERE [编号] = N'DEMO-CAT' AND [类别] IS NULL)
             AND EXISTS (SELECT 1 FROM [物料类别] WHERE [编号] = N'DEMO-CAT-01' AND [类别] = N'DEMO-CAT')
             AND EXISTS (SELECT 1 FROM [物料类别] WHERE [编号] = N'DEMO-CAT-02' AND [类别] = N'DEMO-CAT')
            THEN N'PASS' ELSE N'FAIL' END;

-- 02 基础主数据：内部厂类别供应商 + 客户 + 部门 + 加工厂
INSERT INTO @结果
SELECT 2, N'基础：内部厂类别供应商/客户/部门/加工厂均存在',
       CASE WHEN EXISTS (SELECT 1 FROM [供应商资料] WHERE [供应商编号] = N'DEMO-SUP-INT' AND [供应商类别] = N'内部厂')
             AND EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号] = N'DEMO-CUS-001')
             AND EXISTS (SELECT 1 FROM [部门信息] WHERE [编号] = N'DEMO-D01')
             AND EXISTS (SELECT 1 FROM [加工厂资料] WHERE [加工厂编号] = N'DEMO-FAC-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- 03 仓库位置 2 条 + 物料资料.仓库位置 引用其一
INSERT INTO @结果
SELECT 3, N'仓库位置：2 条字典且物料资料.仓库位置已引用',
       CASE WHEN (SELECT COUNT(*) FROM [仓库位置] WHERE [编号] LIKE N'DEMO-LOC-%') = 2
             AND EXISTS (SELECT 1 FROM [物料资料] m JOIN [仓库位置] w ON w.[编号] = m.[仓库位置]
                         WHERE m.[物料编号] = N'DEMO-MAT-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- 04 啤机机型字典：工模表.啤机机型 全部命中 啤机机型啤工表
INSERT INTO @结果
SELECT 4, N'啤机机型字典：工模表.啤机机型 全部存在于 啤机机型啤工表',
       CASE WHEN NOT EXISTS (
                SELECT g.[啤机机型] FROM [工模表] g
                WHERE g.[工模编号] LIKE N'DEMO%' AND g.[啤机机型] IS NOT NULL
                EXCEPT
                SELECT j.[啤机机型] FROM [啤机机型啤工表] j)
            THEN N'PASS' ELSE N'FAIL' END;

-- 05 工模编号大写：DEMO 工模编号不含小写字母（与 UPPER 自身做大小写敏感比对；LIKE [a-z] 区间在 CS 排序下会误伤大写字母，不可用）
INSERT INTO @结果
SELECT 5, N'工模表：工模编号大写规则（无小写字母）',
       CASE WHEN NOT EXISTS (SELECT 1 FROM [工模表]
                             WHERE [工模编号] LIKE N'DEMO%'
                               AND [工模编号] COLLATE Latin1_General_CS_AS <> UPPER([工模编号]) COLLATE Latin1_General_CS_AS)
             AND EXISTS (SELECT 1 FROM [工模表] WHERE [工模编号] = N'DEMO-MOLD-01')
            THEN N'PASS' ELSE N'FAIL' END;

-- 06 四量校验数据：DEMO 行 套数 = 出模数 ÷ 用量 成立（校验逻辑在 API，此处验证落库数据满足规则）
INSERT INTO @结果
SELECT 6, N'四量校验数据：塑胶共用物料表 DEMO 行 套数=出模数÷用量 全部成立',
       CASE WHEN NOT EXISTS (SELECT 1 FROM [塑胶共用物料表]
                             WHERE [塑胶货号] LIKE N'DEMO%'
                               AND ISNULL([出模数],0) > 0 AND ISNULL([用量],0) > 0
                               AND [套数] <> [出模数] / [用量])
             AND EXISTS (SELECT 1 FROM [塑胶共用物料表]
                         WHERE [塑胶货号] = N'DEMO-PLASTIC-01'
                           AND [出模数] = 4 AND [用量] = 1 AND [套数] = 4)
            THEN N'PASS' ELSE N'FAIL' END;

-- 07 二次加工推导数据：加工内容=电镀 + 二次加工内容=印喷 的行已落库（BD 推导在代码层）
INSERT INTO @结果
SELECT 7, N'二次加工：电镀(B)+印喷(D) 行存在（推导 BD 类在 API 层）',
       CASE WHEN EXISTS (SELECT 1 FROM [塑胶共用物料表]
                         WHERE [塑胶货号] LIKE N'DEMO%'
                           AND [加工内容] = N'电镀' AND [二次加工内容] = N'印喷')
            THEN N'PASS' ELSE N'FAIL' END;

-- 08 多色共模：同一工模编号下存在多个不同颜色的共用物料行
INSERT INTO @结果
SELECT 8, N'多色共模：同一工模编号挂多色行',
       CASE WHEN EXISTS (SELECT [工模编号] FROM [塑胶共用物料表]
                         WHERE [塑胶货号] LIKE N'DEMO%'
                         GROUP BY [工模编号]
                         HAVING COUNT(DISTINCT ISNULL([颜色], N'')) > 1)
            THEN N'PASS' ELSE N'FAIL' END;

-- 09 工模编号引用完整性：塑胶共用物料表.工模编号 全部存在于 工模表（EXCEPT 应为空）
INSERT INTO @结果
SELECT 9, N'工模编号引用：塑胶共用物料表.工模编号 全部存在于 工模表',
       CASE WHEN NOT EXISTS (
                SELECT p.[工模编号] FROM [塑胶共用物料表] p
                WHERE p.[塑胶货号] LIKE N'DEMO%' AND p.[工模编号] IS NOT NULL
                EXCEPT
                SELECT g.[工模编号] FROM [工模表] g)
            THEN N'PASS' ELSE N'FAIL' END;

-- 10 盘点回写口径：模拟审核后 物料资料.库存 = 盘点数量 = 80（60 脚本按 ApproveAsync 同口径 UPDATE）
INSERT INTO @结果
SELECT 10, N'盘点回写：审核后 物料资料.库存=80（模拟 ApproveAsync 口径）',
       CASE WHEN EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号] = N'DEMO-MAT-001' AND [库存] = 80.0000)
             AND EXISTS (SELECT 1 FROM [盘点单] WHERE [单号] = N'DEMO-PD-001' AND [审核] = N'1')
             AND EXISTS (SELECT 1 FROM [盘点明细单] WHERE [单号] = N'DEMO-PD-001'
                         AND [系统数量] = 100 AND [盘点数量] = 80 AND [盈亏数量] = -20)
            THEN N'PASS' ELSE N'FAIL' END;

-- 11 采购分析读库存：按 AuxiliaryPurchaseAnalysis 口径 MAX(ISNULL(库存,0)) 读到 80
INSERT INTO @结果
SELECT 11, N'采购分析口径：MAX(ISNULL(物料资料.库存,0)) = 80（盘点扣数联动读取点）',
       CASE WHEN (SELECT MAX(ISNULL(m.[库存], 0)) FROM [物料资料] m
                  WHERE m.[物料编号] = N'DEMO-MAT-001') = 80.0000
            THEN N'PASS' ELSE N'FAIL' END;

-- 12 多层级 BOM：成品含半成品行，且两级半成品行款号都存在于 半成品共用物料设置
INSERT INTO @结果
SELECT 12, N'多层级BOM：成品调入SEMI-001、SEMI-001调入SEMI-002，且均在半成品共用物料设置注册',
       CASE WHEN EXISTS (SELECT 1 FROM [款号物料明细表] WHERE [款号] = N'DEMO-STY-001'  AND [物料编号] = N'DEMO-SEMI-001')
             AND EXISTS (SELECT 1 FROM [款号物料明细表] WHERE [款号] = N'DEMO-SEMI-001' AND [物料编号] = N'DEMO-SEMI-002')
             AND EXISTS (SELECT 1 FROM [半成品共用物料设置] WHERE [产品货号] = N'DEMO-SEMI-001')
             AND EXISTS (SELECT 1 FROM [半成品共用物料设置] WHERE [产品货号] = N'DEMO-SEMI-002')
            THEN N'PASS' ELSE N'FAIL' END;

-- 13 半成品扩展留空：类别/装配方式/库存单价HK 为 NULL（待 StyleService 保存时自动计算）
INSERT INTO @结果
SELECT 13, N'半成品扩展：类别/装配方式/库存单价HK 留空（待自动计算）',
       CASE WHEN NOT EXISTS (SELECT 1 FROM [半成品共用物料设置]
                             WHERE [产品货号] LIKE N'DEMO%'
                               AND ([类别] IS NOT NULL OR [装配方式] IS NOT NULL OR [库存单价HK] IS NOT NULL))
            THEN N'PASS' ELSE N'FAIL' END;

-- 14 本厂行：装配物料报价存在本厂行且合作方编号/名称为空（CK_装配物料报价_本厂无合作方 成立）
INSERT INTO @结果
SELECT 14, N'本厂行：装配物料报价 本厂行 合作方编号/名称为空（CK 约束）',
       CASE WHEN EXISTS (SELECT 1 FROM [装配物料报价]
                         WHERE [产品货号] = N'DEMO-STY-001' AND [合作方类型] = N'本厂'
                           AND NULLIF(LTRIM(RTRIM(ISNULL([合作方编号], N''))), N'') IS NULL
                           AND NULLIF(LTRIM(RTRIM(ISNULL([合作方名称], N''))), N'') IS NULL)
             AND EXISTS (SELECT 1 FROM [装配物料报价]
                         WHERE [产品货号] = N'DEMO-STY-001' AND [合作方类型] = N'加工厂'
                           AND [合作方编号] = N'DEMO-FAC-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- 15 装配快照：装配加工采购单明细行数>0（快照语义：落库后不再实时展开，
--     与 款号物料明细表 实时行数无强制相等——本例快照 3 行（展开后）vs BOM 实时 5 行（未展开），正体现快照语义）
INSERT INTO @结果
SELECT 15, N'装配快照：装配加工采购单明细 行数>0（快照与实时BOM行数无强制相等）',
       CASE WHEN (SELECT COUNT(*) FROM [装配加工采购单明细] WHERE [单号] = N'DEMO-ZP-001') > 0
             AND EXISTS (SELECT 1 FROM [装配加工采购单生产明细] WHERE [单号] = N'DEMO-ZP-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- 16 来料标签单：头 + 2 明细且标签数>0
INSERT INTO @结果
SELECT 16, N'来料标签单：1 头 2 明细，标签数>0',
       CASE WHEN EXISTS (SELECT 1 FROM [来料标签单] WHERE [电脑单号] = N'DEMO-LBL-001')
             AND (SELECT COUNT(*) FROM [来料标签明细] d
                  JOIN [来料标签单] h ON h.[ID] = d.[标签单ID]
                  WHERE h.[电脑单号] = N'DEMO-LBL-001' AND d.[标签数] > 0) = 2
            THEN N'PASS' ELSE N'FAIL' END;

-- 17 塑胶标签单：头 + 明细且标签数>0
INSERT INTO @结果
SELECT 17, N'塑胶标签单：1 头 1 明细，标签数>0',
       CASE WHEN EXISTS (SELECT 1 FROM [塑胶标签单] WHERE [电脑单号] = N'DEMO-PLBL-001')
             AND (SELECT COUNT(*) FROM [塑胶标签明细] d
                  JOIN [塑胶标签单] h ON h.[ID] = d.[标签单ID]
                  WHERE h.[电脑单号] = N'DEMO-PLBL-001' AND d.[标签数] > 0) = 1
            THEN N'PASS' ELSE N'FAIL' END;

-- 18 采购入仓单：头（未审核）+ 明细带合同号
INSERT INTO @结果
SELECT 18, N'采购入仓单：头存在（未审核）且明细带合同号',
       CASE WHEN EXISTS (SELECT 1 FROM [采购入仓单] WHERE [单号] = N'DEMO-RCV-001' AND ISNULL([审核], N'0') = N'0')
             AND EXISTS (SELECT 1 FROM [采购入仓明细单] WHERE [单号] = N'DEMO-RCV-001'
                         AND NULLIF(LTRIM(RTRIM(ISNULL([合同号], N''))), N'') IS NOT NULL)
            THEN N'PASS' ELSE N'FAIL' END;

-- 19 领料单：头带生产单号 + 明细（FK_228/FK_232 间接验证：生产单号存在于 生产制单）
INSERT INTO @结果
SELECT 19, N'领料单：头/明细带生产单号且 生产单号 存在于 生产制单',
       CASE WHEN EXISTS (SELECT 1 FROM [领料单] WHERE [单号] = N'DEMO-ISS-001' AND [生产单号] = N'DEMO-MO-001')
             AND EXISTS (SELECT 1 FROM [领料明细单] WHERE [单号] = N'DEMO-ISS-001' AND [生产单号] = N'DEMO-MO-001')
             AND EXISTS (SELECT 1 FROM [生产制单] WHERE [生产单号] = N'DEMO-MO-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- 20 生产通知单 → 生产BOM物料清单：模拟采购分析结果行已落库
INSERT INTO @结果
SELECT 20, N'生产BOM物料清单：DEMO-MO-001 模拟采购分析结果行 >0（含需订/订货数量）',
       CASE WHEN (SELECT COUNT(*) FROM [生产BOM物料清单]
                  WHERE [生产单号] = N'DEMO-MO-001' AND ISNULL([订货数量], 0) > 0) >= 2
             AND EXISTS (SELECT 1 FROM [生产制单货号] WHERE [生产单号] = N'DEMO-MO-001' AND [货号] = N'DEMO-STY-001')
             AND EXISTS (SELECT 1 FROM [生产通知单MO单] WHERE [生产单号] = N'DEMO-MO-001' AND [产品货号] = N'DEMO-STY-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- 21 采购物料设置：DEMO 物料 损耗率=5（CK 0~100）且默认供应商非空
INSERT INTO @结果
SELECT 21, N'采购物料设置：DEMO-MAT-001 损耗率=5 且默认供应商非空',
       CASE WHEN EXISTS (SELECT 1 FROM [采购物料设置]
                         WHERE [物料编号] = N'DEMO-MAT-001' AND [采购损耗率] = 5.0000
                           AND NULLIF(LTRIM(RTRIM(ISNULL([默认供应商], N''))), N'') IS NOT NULL)
            THEN N'PASS' ELSE N'FAIL' END;

-- 22 塑胶物料设置：默认仓库非空
INSERT INTO @结果
SELECT 22, N'塑胶物料设置：DEMO-PLA-001 默认仓库非空',
       CASE WHEN EXISTS (SELECT 1 FROM [塑胶物料设置]
                         WHERE [物料编号] = N'DEMO-PLA-001'
                           AND NULLIF(LTRIM(RTRIM(ISNULL([默认仓库], N''))), N'') IS NOT NULL)
            THEN N'PASS' ELSE N'FAIL' END;

-- 23 图片备注：元数据行存在（模块=BOM，单号=成品款号）
INSERT INTO @结果
SELECT 23, N'图片备注：BOM 模块元数据行存在（仅行无文件）',
       CASE WHEN EXISTS (SELECT 1 FROM [图片备注] WHERE [模块] = N'BOM' AND [单号] = N'DEMO-STY-001')
            THEN N'PASS' ELSE N'FAIL' END;

-- ============================================================================
-- 输出：逐行结果 + 总计
-- ============================================================================
SELECT [序号], [检查项], [结果] FROM @结果 ORDER BY [序号];

SELECT
    COUNT(*) AS [检查总数],
    SUM(CASE WHEN [结果] = N'PASS' THEN 1 ELSE 0 END) AS [PASS数],
    SUM(CASE WHEN [结果] = N'FAIL' THEN 1 ELSE 0 END) AS [FAIL数],
    CASE WHEN SUM(CASE WHEN [结果] = N'FAIL' THEN 1 ELSE 0 END) = 0
         THEN N'全部通过 ✅' ELSE N'存在 FAIL，请逐项排查 ❌' END AS [总结论]
FROM @结果;
