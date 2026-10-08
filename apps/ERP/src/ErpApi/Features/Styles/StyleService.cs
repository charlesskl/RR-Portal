using Dapper;
using ErpApi.Data;
using ErpApi.Data.Entities;
using ErpApi.Engines.Bom;
using ErpApi.Features.Messages;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Features.Styles;

public sealed class StyleService(ISqlConnectionFactory factory, ErpDbContext db, MessageService? messages = null)
{
    // 款式全貌：主档 + 颜色集 + 尺码集 + 工序工价 + BOM物料（订单/制单页面据此带出数据）
    // 注：EF(主档/工序/物料) 与 Dapper(颜色/尺码) 用两条连接做只读聚合，非原子快照——本服务只读，足够。
    public async Task<StyleFullDto?> GetFullAsync(string 款号)
    {
        var 主档 = await db.款号总表.AsNoTracking().FirstOrDefaultAsync(s => s.款号 == 款号);
        if (主档 is null) return null;

        using var c = factory.Create();
        var 颜色 = (await c.QueryAsync<StyleColorDto>(
            "SELECT [颜色编号],[颜色名称] FROM [款号颜色表] WHERE [款号]=@款号 ORDER BY [ID]",
            new { 款号 })).AsList();
        var 尺码 = (await c.QueryAsync<string>(
            "SELECT [尺码] FROM [款号尺码表] WHERE [款号]=@款号 ORDER BY [ID]",
            new { 款号 })).AsList();
        var 工序 = await db.款号明细表.AsNoTracking()
            .Where(x => x.款号 == 款号).OrderBy(x => x.工序号).ToListAsync();
        var 物料 = await db.款号物料明细表.AsNoTracking()
            .Where(x => x.款号 == 款号).OrderBy(x => x.ID).ToListAsync();
        return new StyleFullDto(主档, 颜色, 尺码, 工序, 物料);
    }

    // BOM物料设置轻量载入：最新款式、物料头、明细、扩展和报价。
    public async Task<StyleMaterialsViewDto?> GetMaterialsViewAsync(string 款号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(@"
SELECT TOP (1) [款号],[款式]
FROM [款号总表]
WHERE [款号]=@款号
ORDER BY [ID] DESC;
SELECT [ID],[日期],[顺序],[客户编号],[客户名称],[款号],[款式],[物料类别],
       [物料编号],[物料名称],[规格],[颜色],[单位],[使用数量],[工模编号],[备注]
FROM [款号物料明细表]
WHERE [款号]=@款号
ORDER BY CASE WHEN TRY_CONVERT(int,[顺序]) IS NULL THEN 1 ELSE 0 END,
         TRY_CONVERT(int,[顺序]), [ID];
SELECT TOP (1) [产品编号],[单位],[备注],[日期],[客户编号],[客户名称],[默认单价],[类型],[操作员],[审核],[MA货号],
       [反审核申请],[反审核申请人],[反审核申请原因],[待绑定PO号]
FROM [款号物料总表]
WHERE [款号]=@款号
ORDER BY [ID] DESC;
SELECT TOP (1) [产品装配名称],[配件编号],[共用物料编号],[装配方式],[类别],
       [库存单价HK],[其他成本HK],[需求用量],[单位],[半成品计算库存],[备注内容],
       [调整审核],[审核人],[审核时间]
FROM [半成品共用物料设置]
WHERE [产品货号]=@款号
ORDER BY [ID] DESC;
SELECT [ID],[物料编号],[物料名称],[合作方类型],[合作方编号],[合作方名称],
       [报价日期],[货币],[单价],[港币价],[对比相差],[相差比例],[是否默认],[顺序],[备注]
FROM [装配物料报价]
WHERE [产品货号]=@款号
ORDER BY [顺序],[ID];
-- 最近一条 PO 绑定(待绑定PO号 审核绑定后清空,展示用有效 PO=待绑定 ?? 最近绑定)
SELECT TOP (1) [PO号]
FROM [款号物料PO绑定]
WHERE [款号]=@款号
ORDER BY [绑定时间] DESC, [ID] DESC;", new { 款号 });

        var style = await multi.ReadFirstOrDefaultAsync<StyleHeaderRow>();
        if (style is null) return null;
        var 物料 = (await multi.ReadAsync<款号物料明细表>()).AsList();
        var header = await multi.ReadFirstOrDefaultAsync<MaterialHeaderRow>();
        var 扩展 = await multi.ReadFirstOrDefaultAsync<AssemblyMaterialExtensionDto>();
        var quotes = (await multi.ReadAsync<AssemblyMaterialQuoteDto>()).AsList();
        var 最近绑定PO号 = await multi.ReadFirstOrDefaultAsync<string>();
        IReadOnlyList<AssemblyMaterialQuoteDto>? 报价 = quotes.Count == 0 ? null : quotes;
        var 单头 = header is null ? null : new BomHeaderViewDto(
            header.日期, header.客户编号, header.客户名称, header.单位,
            header.默认单价, header.类型, header.操作员, header.审核, header.备注, header.MA货号,
            header.反审核申请, header.反审核申请人, header.反审核申请原因,
            string.IsNullOrWhiteSpace(header.待绑定PO号) ? 最近绑定PO号 : header.待绑定PO号);
        return new StyleMaterialsViewDto(款号, style.款式, 物料, 扩展, 报价, 单头);
    }

    // 整组替换颜色集（先删后插；ID 列无自增，写成排序号保证顺序稳定）
    public async Task ReplaceColorsAsync(string 款号, IReadOnlyList<StyleColorDto> colors)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var exists = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx);
        if (exists == 0) throw new InvalidOperationException($"款号 [{款号}] 不存在。");
        var 款式 = await c.ExecuteScalarAsync<string?>(
            "SELECT [款式] FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx);
        await c.ExecuteAsync("DELETE FROM [款号颜色表] WHERE [款号]=@款号", new { 款号 }, tx);
        for (var i = 0; i < colors.Count; i++)
            await c.ExecuteAsync(@"
INSERT INTO [款号颜色表]([款号],[款式],[颜色编号],[颜色名称],[ID])
VALUES(@款号,@款式,@颜色编号,@颜色名称,@ID)",
                new { 款号, 款式, colors[i].颜色编号, colors[i].颜色名称, ID = (long)(i + 1) }, tx);
        tx.Commit();
    }

    // 真删除整张 BOM(台头 款号物料总表 + 明细 款号物料明细表)：未审核才能删(两套审核口径同 ReplaceMaterialsAsync);
    // 已被生产通知单引用(生产制单货号.BOM款号)的拒绝删除。款号总表(款式档案)不动。
    public async Task DeleteBomAsync(string 款号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var exists = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号物料总表] WITH (UPDLOCK, HOLDLOCK) WHERE [款号]=@款号", new { 款号 }, tx);
        if (exists == 0) throw new KeyNotFoundException($"款号 [{款号}] 没有 BOM。");

        var audited = await c.ExecuteScalarAsync<bool>(@"
SELECT CAST(ISNULL([调整审核],0) AS bit)
FROM [半成品共用物料设置] WHERE [产品货号]=@款号;", new { 款号 }, tx);
        if (audited) throw new InvalidOperationException($"款号 [{款号}] 已审核，不能删除，请先反审核。");

        var bomAudited = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [款号物料总表] WHERE [款号]=@款号;", new { 款号 }, tx);
        if (bomAudited == "1") throw new InvalidOperationException($"款号 [{款号}] 的 BOM 已审核，请先反审核再删除。");

        var 被引用 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [生产制单货号] WHERE [BOM款号]=@款号", new { 款号 }, tx);
        if (被引用 > 0)
            throw new InvalidOperationException($"款号 [{款号}] 的 BOM 已被生产通知单引用（{被引用} 行），不能删除。");

        await c.ExecuteAsync("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 }, tx);
        await c.ExecuteAsync("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 }, tx);
        tx.Commit();
    }

    // 整组替换 BOM、装配扩展和报价；三部分共用一个 Dapper 事务。
    // 返回保存警告（不阻止保存）：明细直接物料与所调入半成品的组成物料重复（会重复扣料）、半成品循环引用等。
    public async Task<IReadOnlyList<string>> ReplaceMaterialsAsync(string 款号, BomSaveDto dto, bool canEditPrices = true, string? 操作员 = null)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var exists = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx);
            // 新款号直接建 BOM：自动在 款号总表 建档(款式取表单产品名称),不再要求先建款号
            if (exists == 0)
                await c.ExecuteAsync("INSERT INTO [款号总表]([款号],[款式]) VALUES(@款号,@款式);",
                    new { 款号, 款式 = string.IsNullOrWhiteSpace(dto.款式) ? null : dto.款式.Trim() }, tx);

            var audited = await c.ExecuteScalarAsync<bool>(@"
SELECT CAST(ISNULL([调整审核],0) AS bit)
FROM [半成品共用物料设置] WITH (UPDLOCK, HOLDLOCK)
WHERE [产品货号]=@款号;", new { 款号 }, tx);
            if (audited)
                throw new InvalidOperationException($"款号 [{款号}] 已审核，不能保存，请先反审核。");

            // BOM 台头已审核同样禁改(旧说明书 3-1:审核后必须反审核才能修改;与装配 调整审核 是两套)
            var bomAudited = await c.ExecuteScalarAsync<string?>(@"
SELECT ISNULL([审核],'0') FROM [款号物料总表] WITH (UPDLOCK, HOLDLOCK) WHERE [款号]=@款号;",
                new { 款号 }, tx);
            if (bomAudited == "1")
                throw new InvalidOperationException($"款号 [{款号}] 的 BOM 已审核，请先反审核再修改。");

            // 实单版关联的模板 MA 货号（MA 版传 null）；校验放行与台头落库共用该值
            var ma货号 = string.IsNullOrWhiteSpace(dto.MA货号) ? null : dto.MA货号.Trim();

            // 物料编号列宽防御（物料资料.物料编号 = nvarchar(20)，不加宽，见 db/56_widen_material_code.sql 评估）：
            // 半成品款号可超过 20 字，调入 BOM 后塞不进 物料编号 列；即便截断写入，半成品行判定
            // （编号 ∈ 半成品共用物料设置.产品货号）也会失效，多层级展开按普通物料错算。超长半成品款号直接拒绝调入。
            var 明细行 = dto.明细 ?? [];
            if (明细行.Any(m => (m.物料编号?.Trim().Length ?? 0) > 20))
            {
                var semiSet = new HashSet<string>(
                    await c.QueryAsync<string>("SELECT [产品货号] FROM [半成品共用物料设置]", transaction: tx),
                    StringComparer.OrdinalIgnoreCase);
                foreach (var m in 明细行)
                {
                    var code = m.物料编号?.Trim();
                    if (code is { Length: > 20 } && semiSet.Contains(code))
                        throw new InvalidOperationException(
                            $"半成品款号 [{code}] 超过物料编号长度上限 20 字，无法调入 BOM；请将该半成品款号改短至 20 字以内后再调入。");
                }
            }

            // FK_133 已放开(db/68,允许混合 来料+塑胶 BOM):应用层兜底——物料编号须存在于 物料资料 或 塑胶物料资料
            var codes = 明细行.Select(m => m.物料编号?.Trim())
                .Where(x => !string.IsNullOrEmpty(x))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (codes.Length > 0)
            {
                var known = new HashSet<string>(await c.QueryAsync<string>(@"
SELECT [物料编号] FROM [物料资料] WHERE [物料编号] IN @codes
UNION ALL
SELECT [物料编号] FROM [塑胶物料资料] WHERE [物料编号] IN @codes;",
                    new { codes }, tx), StringComparer.OrdinalIgnoreCase);
                // 放行：编号=半成品设置.名称 的行(半成品/包装行 编号=定义名称,不在物料档案)；
                // 实单版可勾选关联 MA 货号的定义,故名称集合并本货号与 MA货号 两组。
                var defNames = new HashSet<string>(await c.QueryAsync<string>(@"
SELECT [名称] FROM [半成品设置]
WHERE [货号]=@款号 OR (@MA货号 IS NOT NULL AND [货号]=@MA货号);",
                    new { 款号, MA货号 = ma货号 }, tx), StringComparer.OrdinalIgnoreCase);
                var missing = codes.Where(x => !known.Contains(x!) && !defNames.Contains(x!)).ToList();
                if (missing.Count > 0)
                    throw new InvalidOperationException(
                        $"物料编号不存在(物料资料/塑胶物料资料)：{string.Join("、", missing)}");
            }

            var saveDto = dto;
            if (!canEditPrices && (dto.扩展 is not null || dto.报价 is not null))
            {
                var existingExtension = dto.扩展 is null
                    ? null
                    : await c.QueryFirstOrDefaultAsync<AssemblyMaterialExtensionDto>(@"
SELECT TOP (1) [产品装配名称],[配件编号],[共用物料编号],[装配方式],[类别],
       [库存单价HK],[其他成本HK],[需求用量],[单位],[半成品计算库存],[备注内容],
       [调整审核],[审核人],[审核时间]
FROM [半成品共用物料设置] WITH (UPDLOCK, HOLDLOCK)
WHERE [产品货号]=@款号
ORDER BY [ID] DESC;", new { 款号 }, tx);
                var existingQuotes = dto.报价 is null
                    ? []
                    : (await c.QueryAsync<AssemblyMaterialQuoteDto>(@"
SELECT [ID],[物料编号],[物料名称],[合作方类型],[合作方编号],[合作方名称],
       [报价日期],[货币],[单价],[港币价],[对比相差],[相差比例],[是否默认],[顺序],[备注]
FROM [装配物料报价] WITH (UPDLOCK, HOLDLOCK)
WHERE [产品货号]=@款号
ORDER BY [顺序],[ID];", new { 款号 }, tx)).AsList();
                saveDto = StyleMaterialsPricePolicy.PreserveProtectedPrices(
                    dto, existingExtension, existingQuotes);
            }

            ValidateQuotes(saveDto.报价);

            // 产品名称(款式):表单提交值优先——BOM 页产品名称可编辑,老货号保存即同步款号总表;
            // 未提交(空)则沿用款号总表现有值,不把已有名称抹掉。
            var 提交款式 = string.IsNullOrWhiteSpace(dto.款式) ? null : dto.款式.Trim();
            if (提交款式 is not null && exists > 0)
                await c.ExecuteAsync("UPDATE [款号总表] SET [款式]=@款式 WHERE [款号]=@款号;",
                    new { 款号, 款式 = 提交款式 }, tx);
            var 款式 = 提交款式 ?? await c.ExecuteScalarAsync<string?>(
                "SELECT TOP (1) [款式] FROM [款号总表] WHERE [款号]=@款号 ORDER BY [ID] DESC", new { 款号 }, tx);
            await c.ExecuteAsync("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 }, tx);
            var materials = saveDto.明细 ?? [];
            for (var i = 0; i < materials.Count; i++)
            {
                var m = materials[i];
                await c.ExecuteAsync(@"
INSERT INTO [款号物料明细表]([款号],[款式],[顺序],[客户编号],[客户名称],[日期],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[使用数量],[工模编号],[备注])
VALUES(@款号,@款式,@顺序,@客户编号,@客户名称,@日期,@物料编号,@物料名称,@物料类别,@规格,@颜色,@单位,@使用数量,@工模编号,@备注)",
                    new
                    {
                        款号, 款式, 顺序 = (i + 1).ToString(),
                        saveDto.客户编号, saveDto.客户名称, saveDto.日期,
                        m.物料编号, m.物料名称, m.物料类别, m.规格, m.颜色,
                        m.工模编号,
                        单位 = string.IsNullOrWhiteSpace(m.单位) ? saveDto.单位 : m.单位,
                        m.使用数量, m.备注
                    }, tx);
            }

            // 台头(款号物料总表)upsert:旧版表头字段 客户/日期/单位/默认单价/类型;审核 新建='0'(分析口径不变),更新不动 审核/操作员
            // MA货号：实单版关联的模板 MA 货号(MA 版保存传 null 清掉)
            // 待绑定PO号：从排期跳转建 BOM 带入,审核成功后自动绑定到 款号物料PO绑定 并清空(见 BomSetAuditAsync)
            var 待绑定PO号 = string.IsNullOrWhiteSpace(saveDto.待绑定PO号) ? null : saveDto.待绑定PO号.Trim();
            await c.ExecuteAsync(@"
MERGE [款号物料总表] AS t
USING (SELECT @款号 AS [款号]) s ON t.[款号]=s.[款号]
WHEN MATCHED THEN UPDATE SET
    [日期]=@日期,[客户编号]=@客户编号,[客户名称]=@客户名称,[款式]=@款式,
    [单位]=@单位,[默认单价]=@默认单价,[类型]=@类型,[MA货号]=@MA货号,[待绑定PO号]=@待绑定PO号
WHEN NOT MATCHED THEN
    INSERT([日期],[客户编号],[客户名称],[款号],[款式],[单位],[默认单价],[类型],[审核],[操作员],[MA货号],[待绑定PO号])
    VALUES(@日期,@客户编号,@客户名称,@款号,@款式,@单位,@默认单价,@类型,'0',@操作员,@MA货号,@待绑定PO号);",
                new { 款号, 款式, saveDto.客户编号, saveDto.客户名称, saveDto.日期,
                      saveDto.单位, saveDto.默认单价, saveDto.类型, 操作员, MA货号 = ma货号, 待绑定PO号 }, tx);

            if (saveDto.扩展 is not null)
            {
                // 库存单价HK 为空（null/0 视为未手工填写）时自动计算：优先工程BOM单价字段，兜底 BOM 明细 Σ(用量×物料单价)。
                var extension = saveDto.扩展;
                if (extension.库存单价HK is null or 0m)
                    extension = extension with
                    {
                        库存单价HK = await ComputeInventoryPriceAsync(c, tx, 款号, extension.类别)
                    };
                await UpsertExtensionAsync(c, tx, 款号, extension);
            }

            if (saveDto.报价 is not null)
            {
                await c.ExecuteAsync("DELETE FROM [装配物料报价] WHERE [产品货号]=@款号", new { 款号 }, tx);
                foreach (var q in saveDto.报价)
                    await c.ExecuteAsync(@"
INSERT INTO [装配物料报价]([产品货号],[物料编号],[物料名称],[合作方类型],[合作方编号],[合作方名称],
    [报价日期],[货币],[单价],[港币价],[对比相差],[相差比例],[是否默认],[顺序],[备注])
VALUES(@产品货号,@物料编号,@物料名称,@合作方类型,@合作方编号,@合作方名称,
    @报价日期,@货币,@单价,@港币价,@对比相差,@相差比例,@是否默认,@顺序,@备注)",
                        new
                        {
                            产品货号 = 款号, q.物料编号, q.物料名称, q.合作方类型, q.合作方编号,
                            q.合作方名称, q.报价日期, q.货币, q.单价, q.港币价, q.对比相差,
                            q.相差比例, q.是否默认, q.顺序, q.备注
                        }, tx);
            }

            // 保存警告（同事务读取刚写入的明细）：既调半成品又直接列其组成物料 → 重复扣料风险。
            var 警告 = await CollectHierarchyWarningsAsync(c, tx, materials);

            tx.Commit();
            return 警告;
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    // 复制单：把源款号的 BOM 明细（及装配扩展/报价，若有）整组复制到目标款号。
    // 目标已审核、目标已有 BOM 且未指定覆盖、或源无 BOM 时拒绝；写入复用 ReplaceMaterialsAsync 整组替换语义。
    // 注：检查与写入非同一事务（同本服务只读聚合的项目级权衡），ReplaceMaterialsAsync 内部仍事务化。
    public async Task CopyMaterialsAsync(string 源款号, string 目标款号, bool 覆盖)
    {
        目标款号 = 目标款号.Trim();
        if (string.Equals(源款号, 目标款号, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("目标款号不能与源款号相同。");

        var view = await GetMaterialsViewAsync(源款号);
        if (view is null) throw new InvalidOperationException($"款号 [{源款号}] 不存在。");
        if (view.物料.Count == 0)
            throw new InvalidOperationException($"款号 [{源款号}] 没有 BOM 物料明细，无法复制。");

        using var c = factory.Create();
        await c.OpenAsync();
        var targetExists = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号总表] WHERE [款号]=@款号", new { 款号 = 目标款号 });
        if (targetExists == 0) throw new InvalidOperationException($"款号 [{目标款号}] 不存在。");
        var targetAudited = await c.ExecuteScalarAsync<bool>(@"
SELECT CAST(ISNULL([调整审核],0) AS bit)
FROM [半成品共用物料设置]
WHERE [产品货号]=@款号;", new { 款号 = 目标款号 });
        if (targetAudited)
            throw new InvalidOperationException($"款号 [{目标款号}] 已审核，不能复制覆盖，请先反审核。");
        var targetBomCount = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 = 目标款号 });
        if (targetBomCount > 0 && !覆盖)
            throw new InvalidOperationException($"款号 [{目标款号}] 已有 BOM 物料明细；确认覆盖请使用 覆盖=true。");

        var first = view.物料[0];
        var dto = new BomSaveDto(
            first.客户编号, first.客户名称, first.日期,
            view.扩展?.单位 ?? first.单位,
            view.物料.Select(m => new StyleMaterialDto(
                m.物料编号, m.物料名称, m.物料类别, m.规格, m.颜色,
                m.单位, m.使用数量, m.工模编号, m.备注)).ToList(),
            view.扩展,
            view.报价?.ToList() ?? []);
        await ReplaceMaterialsAsync(目标款号, dto);
    }

    // BOM 台头审核(款号物料总表.审核 翻转;区别于装配审核 半成品共用物料设置.调整审核)。
    // 需领/采购分析只统计 审核='1' 的台头。
    // 审核成功时,若台头 待绑定PO号 非空(从排期跳转建 BOM 带入) → 自动绑定到 款号物料PO绑定(幂等)并清空该列。
    public async Task BomSetAuditAsync(string 款号, bool audited, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var cur = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [款号物料总表] WITH (UPDLOCK, HOLDLOCK) WHERE [款号]=@款号",
            new { 款号 }, tx);
        if (cur is null) throw new InvalidOperationException($"款号 [{款号}] 还没有 BOM 台头，请先保存 BOM。");
        if (audited && cur == "1") throw new InvalidOperationException($"款号 [{款号}] 的 BOM 已审核，请勿重复审核。");
        if (!audited && cur != "1") throw new InvalidOperationException($"款号 [{款号}] 的 BOM 未审核，无需反审核。");
        await c.ExecuteAsync("UPDATE [款号物料总表] SET [审核]=@审核 WHERE [款号]=@款号",
            new { 审核 = audited ? "1" : "0", 款号 }, tx);
        if (audited)
        {
            var 待绑定PO号 = await c.ExecuteScalarAsync<string?>(
                "SELECT [待绑定PO号] FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 }, tx);
            if (!string.IsNullOrWhiteSpace(待绑定PO号))
            {
                await BindPoCoreAsync(c, tx, 款号, 待绑定PO号.Trim());
                await c.ExecuteAsync(
                    "UPDATE [款号物料总表] SET [待绑定PO号]=NULL WHERE [款号]=@款号", new { 款号 }, tx);
            }
        }
        tx.Commit();
    }

    // === BOM 按 PO 号绑定（款号物料PO绑定,业务键=款号;同一货号不同 PO/合同号可能物料不同）===

    // 幂等插入绑定（款号+PO号 唯一约束兜底;HOLDLOCK 防并发重插）。调用方负责参数校验与事务。
    private static Task BindPoCoreAsync(SqlConnection c, SqlTransaction? tx, string 款号, string PO号) =>
        c.ExecuteAsync(@"
MERGE [款号物料PO绑定] WITH (HOLDLOCK) AS t
USING (SELECT @款号 AS [款号], @PO号 AS [PO号]) s
ON t.[款号]=s.[款号] AND t.[PO号]=s.[PO号]
WHEN NOT MATCHED THEN INSERT([款号],[PO号]) VALUES(s.[款号],s.[PO号]);",
            new { 款号, PO号 }, tx);

    // 显式绑定：款号 + PO号(=合同号)。幂等;PO号 为空抛 ArgumentException。
    public async Task BindPoAsync(string 款号, string PO号)
    {
        PO号 = PO号?.Trim() ?? "";
        if (PO号.Length == 0) throw new ArgumentException("PO号不能为空。");
        using var c = factory.Create();
        await c.OpenAsync();
        await BindPoCoreAsync(c, null, 款号.Trim(), PO号);
    }

    // 查绑定列表（按绑定时间排序）
    public async Task<IReadOnlyList<BomPoBindingDto>> GetPoBindingsAsync(string 款号)
    {
        using var c = factory.Create();
        return (await c.QueryAsync<BomPoBindingDto>(@"
SELECT [PO号],[绑定时间] FROM [款号物料PO绑定]
WHERE [款号]=@款号 ORDER BY [绑定时间],[ID];", new { 款号 })).AsList();
    }

    // === BOM 反审核申请-审批流（与生产制单同一口径）===
    // 已审核 BOM 发现有错 → 操作员申请反审核(必填原因) → 消息通知全部经理 → 经理在消息中心
    // 同意=一步到位回到未审核(可改后再审)；拒绝=退回申请。申请期间台头锁定不可改。

    // 经理账号：人事档案 职称='经理' 的 join 账号（口径同 PurchaseApprovalChainService/生产制单）
    private async Task<IReadOnlyList<string>> ManagerAccountsAsync()
    {
        using var c = factory.Create();
        return (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE p.[职称] = N'经理'")).AsList();
    }

    // 是否经理（admin 可代办，口径同采购三级流转）
    public async Task<bool> IsManagerAsync(string user)
    {
        if (user.Equals("admin", StringComparison.OrdinalIgnoreCase)) return true;
        using var c = factory.Create();
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [人事档案] WHERE [姓名]=@user AND [职称]=N'经理'", new { user });
        return n > 0;
    }

    private Task NotifyAsync(IEnumerable<string> 接收人, string? 单号, string 类型, string 标题, string? 内容) =>
        messages is null ? Task.CompletedTask : messages.SendAsync(接收人, 类型, 单号, 标题, 内容);

    // 申请反审核：仅已审核且无待批申请可提；成功后通知全部经理(+admin)。消息 单号 位放款号。
    public async Task RequestBomReverseAuditAsync(string 款号, string? 原因, string user)
    {
        原因 = 原因?.Trim();
        if (string.IsNullOrEmpty(原因)) throw new ArgumentException("请填写反审核原因。");
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [款号物料总表] SET [反审核申请]='1',[反审核申请人]=@user,[反审核申请原因]=@原因,[反审核申请时间]=SYSDATETIME()
WHERE [款号]=@款号 AND ISNULL([审核],'0')='1' AND ISNULL([反审核申请],'0')<>'1'",
            new { 款号, user, 原因 });
        if (n == 0)
        {
            var 存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            if (存在 == 0) throw new KeyNotFoundException($"款号 [{款号}] 还没有 BOM 台头，请先保存 BOM。");
            throw new InvalidOperationException("申请失败：仅已审核且无待批申请的 BOM 才能申请反审核。");
        }
        var 接收人 = (await ManagerAccountsAsync()).Append("admin").Distinct().ToList();
        await NotifyAsync(接收人, 款号, "BOM反审核审批", "工程BOM反审核申请",
            $"[{user}] 申请反审核款号 {款号} 的工程BOM。原因：{原因}。请经理在此消息中处理（同意/拒绝）。");
    }

    // 经理同意：一步到位反审核回未审核，清申请标记；通知申请人
    public async Task<string> ApproveBomReverseAuditRequestAsync(string 款号, string user)
    {
        if (!await IsManagerAsync(user))
            throw new InvalidOperationException($"[{user}] 不是经理，不能批准反审核。");
        using var c = factory.Create();
        var 申请人 = await c.ExecuteScalarAsync<string?>(@"
UPDATE [款号物料总表] SET [审核]='0',
       [反审核申请]='0',[反审核申请人]=NULL,[反审核申请原因]=NULL,[反审核申请时间]=NULL
OUTPUT DELETED.[反审核申请人]
WHERE [款号]=@款号 AND ISNULL([审核],'0')='1' AND ISNULL([反审核申请],'0')='1'", new { 款号 });
        if (申请人 is null)
        {
            var 存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            if (存在 == 0) throw new KeyNotFoundException($"款号 [{款号}] 还没有 BOM 台头。");
            throw new InvalidOperationException("批准失败：该申请已处理或 BOM 已不是已审核状态。");
        }
        if (!string.IsNullOrWhiteSpace(申请人))
            await NotifyAsync([申请人], 款号, "BOM反审核结果", "BOM反审核已批准",
                $"你申请的款号 {款号} 工程BOM反审核已由 [{user}] 批准，BOM 已回到未审核状态，可修改后重新审核。");
        return 申请人 ?? "";
    }

    // 经理拒绝：仅清申请标记(BOM 保持已审核)；通知申请人
    public async Task<string> RejectBomReverseAuditRequestAsync(string 款号, string user)
    {
        if (!await IsManagerAsync(user))
            throw new InvalidOperationException($"[{user}] 不是经理，不能拒绝反审核申请。");
        using var c = factory.Create();
        var 申请人 = await c.ExecuteScalarAsync<string?>(@"
UPDATE [款号物料总表] SET [反审核申请]='0',[反审核申请人]=NULL,[反审核申请原因]=NULL,[反审核申请时间]=NULL
OUTPUT DELETED.[反审核申请人]
WHERE [款号]=@款号 AND ISNULL([反审核申请],'0')='1'", new { 款号 });
        if (申请人 is null)
        {
            var 存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            if (存在 == 0) throw new KeyNotFoundException($"款号 [{款号}] 还没有 BOM 台头。");
            throw new InvalidOperationException("拒绝失败：该申请已处理。");
        }
        if (!string.IsNullOrWhiteSpace(申请人))
            await NotifyAsync([申请人], 款号, "BOM反审核结果", "BOM反审核已拒绝",
                $"你申请的款号 {款号} 工程BOM反审核被 [{user}] 拒绝，BOM 保持已审核状态。");
        return 申请人 ?? "";
    }

    public async Task SetAuditAsync(string 款号, bool audited, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var style = await c.QuerySingleOrDefaultAsync<StyleHeaderRow>(@"
SELECT TOP (1) [款号],[款式] FROM [款号总表]
WHERE [款号]=@款号 ORDER BY [ID] DESC", new { 款号 }, tx);
            if (style is null) throw new InvalidOperationException($"款号 [{款号}] 不存在。");
            var existing = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [半成品共用物料设置] WHERE [产品货号]=@款号", new { 款号 }, tx);
            if (!audited && existing == 0)
                throw new InvalidOperationException($"款号 [{款号}] 尚未审核。");
            var header = await c.QuerySingleOrDefaultAsync<MaterialHeaderRow>(@"
SELECT TOP (1) [产品编号],[单位],[备注]
FROM [款号物料总表] WHERE [款号]=@款号 ORDER BY [ID] DESC", new { 款号 }, tx);

            await c.ExecuteAsync(@"
MERGE [半成品共用物料设置] AS target
USING (SELECT @产品货号 AS [产品货号], @产品装配名称 AS [产品装配名称],
              @配件编号 AS [配件编号], @单位 AS [单位], @备注内容 AS [备注内容]) AS source
ON target.[产品货号] = source.[产品货号]
WHEN MATCHED THEN UPDATE SET
    [调整审核]=@调整审核,
    [审核人]=CASE WHEN @调整审核=1 THEN @审核人 ELSE NULL END,
    [审核时间]=CASE WHEN @调整审核=1 THEN SYSDATETIME() ELSE NULL END
WHEN NOT MATCHED AND @调整审核=1 THEN
    INSERT([产品货号],[产品装配名称],[配件编号],[单位],[备注内容],[调整审核],[审核人],[审核时间])
    VALUES(source.[产品货号],source.[产品装配名称],source.[配件编号],source.[单位],source.[备注内容],@调整审核,@审核人,SYSDATETIME());
", new
            {
                产品货号 = 款号, 产品装配名称 = style.款式, 配件编号 = header?.产品编号,
                单位 = header?.单位, 备注内容 = header?.备注,
                调整审核 = audited ? 1 : 0, 审核人 = user
            }, tx);
            tx.Commit();
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    // 已设置的半成品/成品款号选项：BOM 明细可调入下级半成品（半成品共用物料设置.产品货号 即半成品判定集）
    public async Task<IReadOnlyList<SemiOptionDto>> ListSemiOptionsAsync()
    {
        using var c = factory.Create();
        return (await c.QueryAsync<SemiOptionDto>(@"
SELECT s.[产品货号] AS [款号],
       COALESCE(NULLIF(LTRIM(RTRIM(s.[产品装配名称])),N''), t.[款式]) AS [款式],
       s.[类别], s.[需求用量], s.[单位]
FROM [半成品共用物料设置] s
OUTER APPLY (SELECT TOP (1) [款式] FROM [款号总表] h WHERE h.[款号]=s.[产品货号] ORDER BY h.[ID] DESC) t
ORDER BY s.[产品货号]")).AsList();
    }

    // 装配BOM 领料展开(来料领料单「按装配BOM带入」):款号物料明细表 里的半成品行 × 半成品设置明细
    // 展开成「组装成半成品的物料」。数量=做货数量 × BOM行.使用数量(缺省回落定义.用量) × 明细.使用数量;
    // 同物料(编号+规格+颜色)合并;仓库分类与生产应领同口径(物料资料 优先,塑胶物料资料 次之,都没有按来料)。
    // 半成品定义查询键=台头 MA货号,缺省用款号本身(MA 货号直接建装配BOM 的场景)。
    public async Task<AssemblyIssueViewDto> GetAssemblyIssueAsync(string 款号, decimal 数量)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var ma货号 = await c.QueryFirstOrDefaultAsync<string?>(
            "SELECT TOP (1) [MA货号] FROM [款号物料总表] WHERE [款号]=@款号 ORDER BY [ID] DESC;", new { 款号 });
        var defsKey = string.IsNullOrWhiteSpace(ma货号) ? 款号 : ma货号!.Trim();

        var bomRows = (await c.QueryAsync<BomSemiRow>(@"
SELECT [物料编号],[物料名称],[物料类别],[使用数量]
FROM [款号物料明细表] WHERE [款号]=@款号;", new { 款号 })).AsList();
        var heads = (await c.QueryAsync<SemiHeadRow>(@"
SELECT [ID],[名称],[类型],ISNULL([用量],1) AS [用量]
FROM [半成品设置] WHERE [货号]=@defsKey;", new { defsKey })).AsList();
        var lines = heads.Count == 0 ? [] : (await c.QueryAsync<SemiLineRow>(@"
SELECT [头ID],[物料编号],[物料名称],[规格],[颜色],[单位],[使用数量]
FROM [半成品设置明细] WHERE [头ID] IN @ids ORDER BY [ID];",
            new { ids = heads.Select(h => h.ID).ToArray() })).AsList();
        var linesByHead = lines.GroupBy(l => l.头ID).ToDictionary(g => g.Key, g => g.ToList());
        var defs = heads
            .Where(h => h.类型 == "半成品")
            .Select(h => new SemiDef(h.名称, h.用量, linesByHead.TryGetValue(h.ID, out var ls) ? ls : []))
            .ToList();

        var merged = new Dictionary<string, AssemblyIssueLineDto>(StringComparer.Ordinal);
        var 跳过 = new List<string>();
        foreach (var row in bomRows)
        {
            var no = row.物料编号?.Trim() ?? "";
            var name = row.物料名称?.Trim() ?? "";
            var def = defs.FirstOrDefault(d => (no.Length > 0 && d.名称 == no) || (name.Length > 0 && d.名称 == name));
            if (def is null)
            {
                if ((row.物料类别 ?? "").Trim() == "半成品" && (no.Length > 0 || name.Length > 0))
                    跳过.Add(no.Length > 0 ? no : name);
                continue;
            }
            var 半成品用量 = row.使用数量 ?? def.用量;
            foreach (var l in def.明细)
            {
                var 编号 = l.物料编号?.Trim() ?? "";
                if (编号.Length == 0) continue;
                var qty = 数量 * 半成品用量 * (l.使用数量 ?? 1m);
                var key = $"{编号}|{l.规格?.Trim() ?? ""}|{l.颜色?.Trim() ?? ""}";
                if (merged.TryGetValue(key, out var hit))
                    merged[key] = hit with { 数量 = hit.数量 + qty };
                else
                    merged[key] = new AssemblyIssueLineDto(编号, l.物料名称, l.规格, l.颜色, l.单位, qty, "来料");
            }
        }

        if (merged.Count > 0)
        {
            var ids = merged.Values.Select(r => r.物料编号).ToArray();
            using var multi = await c.QueryMultipleAsync(@"
SELECT [物料编号] FROM [物料资料] WHERE [物料编号] IN @ids;
SELECT [物料编号] FROM [塑胶物料资料] WHERE [物料编号] IN @ids;", new { ids });
            var 来料Set = (await multi.ReadAsync<string>()).AsList().ToHashSet(StringComparer.Ordinal);
            var 塑胶Set = (await multi.ReadAsync<string>()).AsList().ToHashSet(StringComparer.Ordinal);
            foreach (var key in merged.Keys.ToList())
            {
                var r = merged[key];
                var 仓 = 来料Set.Contains(r.物料编号) ? "来料" : 塑胶Set.Contains(r.物料编号) ? "塑胶" : "来料";
                merged[key] = r with { 仓库 = 仓, 数量 = Math.Round(r.数量, 4, MidpointRounding.AwayFromZero) };
            }
        }
        return new AssemblyIssueViewDto([.. merged.Values], [.. 跳过.Distinct(StringComparer.Ordinal)]);
    }

    private sealed record BomSemiRow(string? 物料编号, string? 物料名称, string? 物料类别, decimal? 使用数量);
    private sealed record SemiHeadRow(long ID, string 名称, string 类型, decimal 用量);
    private sealed record SemiLineRow(long 头ID, string? 物料编号, string? 物料名称, string? 规格, string? 颜色, string? 单位, decimal? 使用数量);
    private sealed record SemiDef(string 名称, decimal 用量, IReadOnlyList<SemiLineRow> 明细);

    // 保存警告：本 BOM 直接物料与所调入半成品的(递归)组成物料重复（重复扣料），以及半成品循环/超层级。
    // 半成品行判定与生产展开一致：编号存在于 半成品共用物料设置.产品货号。
    private static async Task<IReadOnlyList<string>> CollectHierarchyWarningsAsync(
        System.Data.IDbConnection c, System.Data.IDbTransaction tx, IReadOnlyList<StyleMaterialDto> materials)
    {
        if (materials.Count == 0) return [];
        var semiSet = new HashSet<string>(
            await c.QueryAsync<string>("SELECT [产品货号] FROM [半成品共用物料设置]", transaction: tx),
            StringComparer.OrdinalIgnoreCase);
        var cache = new Dictionary<string, IReadOnlyList<SemiBomLine>>(StringComparer.OrdinalIgnoreCase);
        IReadOnlyList<SemiBomLine> LinesOf(string k)
        {
            if (!cache.TryGetValue(k, out var lines))
                cache[k] = lines = c.Query<SemiBomLine>(
                    "SELECT [物料编号] AS [编号], [使用数量] AS [用量] FROM [款号物料明细表] WHERE [款号]=@款号",
                    new { 款号 = k }, tx).AsList();
            return lines;
        }
        return SemiBomExpander.FindDuplicateMaterialWarnings(
            materials.Select(m => new SemiBomLine(m.物料编号, m.使用数量)).ToList(),
            LinesOf, semiSet.Contains);
    }

    private static void ValidateQuotes(IReadOnlyList<AssemblyMaterialQuoteDto>? quotes)
    {
        if (quotes is null) return;
        foreach (var quote in quotes)
        {
            if (quote.合作方类型 is not ("本厂" or "加工厂" or "供应商"))
                throw new InvalidOperationException("报价合作方类型必须是本厂、加工厂或供应商。");
            if (quote.合作方类型 == "本厂"
                && (!string.IsNullOrWhiteSpace(quote.合作方编号) || !string.IsNullOrWhiteSpace(quote.合作方名称)))
                throw new InvalidOperationException("本厂报价行不能选择合作方（合作方编号/名称必须为空）。");
        }
        if (quotes.Count(q => q.合作方类型 == "本厂") > 1)
            throw new InvalidOperationException("每个款号至多一行本厂报价。");
    }

    // 库存单价HK 自动计算口径：类别=成品 → 款号总表.[出厂价]；其余（半成品类/未设类别）→ [装彩盒单价]；
    // 主档单价为空则按 BOM 明细 Σ(使用数量 × 物料资料.单价) 兜底（无 priced 物料时返回 null）。
    private static async Task<decimal?> ComputeInventoryPriceAsync(
        System.Data.IDbConnection c, System.Data.IDbTransaction tx, string 款号, string? 类别)
    {
        var column = 类别 == "成品" ? "出厂价" : "装彩盒单价";
        var masterPrice = await c.ExecuteScalarAsync<decimal?>($@"
SELECT TOP (1) [{column}] FROM [款号总表]
WHERE [款号]=@款号 AND [{column}] IS NOT NULL
ORDER BY [ID] DESC;", new { 款号 }, tx);
        if (masterPrice is not null) return masterPrice;
        return await c.ExecuteScalarAsync<decimal?>(@"
SELECT SUM(d.[使用数量] * m.[单价])
FROM [款号物料明细表] d
LEFT JOIN (
    SELECT [物料编号], MAX([单价]) AS [单价]
    FROM [物料资料] GROUP BY [物料编号]
) m ON m.[物料编号]=d.[物料编号]
WHERE d.[款号]=@款号;", new { 款号 }, tx);
    }

    private static Task<int> UpsertExtensionAsync(
        System.Data.IDbConnection c, System.Data.IDbTransaction tx,
        string 产品货号, AssemblyMaterialExtensionDto extension)
        => c.ExecuteAsync(@"
MERGE [半成品共用物料设置] AS target
USING (SELECT @产品货号 AS [产品货号]) AS source
ON target.[产品货号] = source.[产品货号]
WHEN MATCHED THEN UPDATE SET
    [产品装配名称]=@产品装配名称,[配件编号]=@配件编号,[共用物料编号]=@共用物料编号,
    [装配方式]=@装配方式,[类别]=@类别,[库存单价HK]=@库存单价HK,[其他成本HK]=@其他成本HK,
    [需求用量]=@需求用量,[单位]=@单位,[半成品计算库存]=@半成品计算库存,[备注内容]=@备注内容
WHEN NOT MATCHED THEN
    INSERT([产品货号],[产品装配名称],[配件编号],[共用物料编号],[装配方式],[类别],
           [库存单价HK],[其他成本HK],[需求用量],[单位],[半成品计算库存],[备注内容])
    VALUES(@产品货号,@产品装配名称,@配件编号,@共用物料编号,@装配方式,@类别,
           @库存单价HK,@其他成本HK,@需求用量,@单位,@半成品计算库存,@备注内容);",
            new
            {
                产品货号, extension.产品装配名称, extension.配件编号, extension.共用物料编号,
                extension.装配方式, extension.类别, extension.库存单价HK, extension.其他成本HK,
                extension.需求用量, extension.单位, extension.半成品计算库存, extension.备注内容
            }, tx);

    private sealed class StyleHeaderRow
    {
        public string? 款号 { get; set; }
        public string? 款式 { get; set; }
    }

    private sealed class MaterialHeaderRow
    {
        public string? 产品编号 { get; set; }
        public string? 单位 { get; set; }
        public string? 备注 { get; set; }
        public DateTime? 日期 { get; set; }
        public string? 客户编号 { get; set; }
        public string? 客户名称 { get; set; }
        public string? 默认单价 { get; set; }
        public string? 类型 { get; set; }
        public string? 操作员 { get; set; }
        public string? 审核 { get; set; }
        public string? MA货号 { get; set; }
        public string? 反审核申请 { get; set; }
        public string? 反审核申请人 { get; set; }
        public string? 反审核申请原因 { get; set; }
        public string? 待绑定PO号 { get; set; }
    }

    // 整组替换尺码集（顺序即穿着顺序 S/M/L/XL，用 ID 列保序）
    public async Task ReplaceSizesAsync(string 款号, IReadOnlyList<string> sizes)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var exists = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx);
        if (exists == 0) throw new InvalidOperationException($"款号 [{款号}] 不存在。");
        var 款式 = await c.ExecuteScalarAsync<string?>(
            "SELECT [款式] FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx);
        await c.ExecuteAsync("DELETE FROM [款号尺码表] WHERE [款号]=@款号", new { 款号 }, tx);
        for (var i = 0; i < sizes.Count; i++)
            await c.ExecuteAsync(@"
INSERT INTO [款号尺码表]([款号],[款式],[尺码],[ID]) VALUES(@款号,@款式,@尺码,@ID)",
                new { 款号, 款式, 尺码 = sizes[i], ID = (long)(i + 1) }, tx);
        tx.Commit();
    }

    // 生产通知单 货号/BOM款号 选择数据源:
    // ① 款号物料总表(已做 BOM 物料设置的款号,带客户/默认单价等单头信息);
    // ② 款号总表其余款号兜底(仅 款号/款式,无客户信息)——保证手工货号也有 BOM款号 可联动。
    // 货号→BOM款号 的联动关系 = 同款式(如 货号92125A-S001 与 工程款号92125暹罗猫 同为"一窝蛋"),由前端按款式过滤。
    public async Task<IReadOnlyList<BomHeaderOptionDto>> ListBomHeadersAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<BomHeaderOptionDto>(@"
SELECT [款号],[款式],[客户编号],[客户名称],[单位],[默认单价],[类型],[待绑定PO号]
FROM (
    SELECT h.[款号],h.[款式],h.[客户编号],h.[客户名称],h.[单位],h.[默认单价],h.[类型],h.[待绑定PO号], 0 AS [src]
    FROM [款号物料总表] h
    WHERE h.[款号] IS NOT NULL AND LTRIM(RTRIM(h.[款号]))<>''
    UNION ALL
    SELECT g.[款号],g.[款式],CAST(NULL AS nvarchar(20)),CAST(NULL AS nvarchar(60)),CAST(NULL AS nvarchar(10)),CAST(NULL AS nvarchar(30)),CAST(NULL AS nvarchar(10)),CAST(NULL AS nvarchar(50)), 1 AS [src]
    FROM [款号总表] g
    WHERE g.[款号] IS NOT NULL AND LTRIM(RTRIM(g.[款号]))<>''
      AND NOT EXISTS (SELECT 1 FROM [款号物料总表] x WHERE x.[款号]=g.[款号])
      AND EXISTS (SELECT 1 FROM [款号物料明细表] d WHERE d.[款号]=g.[款号])   -- 只列已建 BOM 明细的款号(与 BOM货号查询 口径一致)
) u
WHERE (@kw IS NULL OR [款号] LIKE @kw OR [款式] LIKE @kw OR [客户名称] LIKE @kw)
ORDER BY [款号];", new { kw });
        return rows.AsList();
    }
}
