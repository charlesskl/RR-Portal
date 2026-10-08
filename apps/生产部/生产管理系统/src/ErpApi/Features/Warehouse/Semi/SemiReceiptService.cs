using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品入仓（裁片/半成品入半成品仓）。两层：半成品入仓单 + 半成品入仓明细单(单号 主从 FK)。
// 单价手工，金额=数量×单价；不做加权成本。物料维度。审核位仅在单头(明细表无审核列)。
// 订单单号=客户合同号(生产制单.合同号)：必填，未填时按生产单号自动带出（口径同采购订单）。
public sealed class SemiReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "半成品入仓单";
    public const string Prefix = "BCP";

    // 合同号(订单单号)绑定：未填时按 单头生产单号(或全部明细同属一个生产单) 自动带出 生产制单.合同号；
    // 仍为空则拒单——半成品入仓必须绑定合同号，下游按合同号串联。
    // tx:调用方开了事务必须传入(否则在挂起事务的连接上裸查会被 SQL Server 拒)
    private static async Task<string> Bind订单单号Async(SqlConnection c, SemiReceiptCreateDto dto, SqlTransaction? tx = null)
    {
        var no = dto.订单单号?.Trim();
        if (!string.IsNullOrEmpty(no)) return no;
        string? mo = null;
        if (!string.IsNullOrWhiteSpace(dto.生产单号)) mo = dto.生产单号.Trim();
        else
        {
            var lineMos = dto.明细.Select(l => l.生产单号?.Trim())
                .Where(s => !string.IsNullOrEmpty(s)).Distinct().ToList();
            if (lineMos.Count == 1) mo = lineMos[0];
        }
        if (mo is not null)
            no = (await c.ExecuteScalarAsync<string?>(
                "SELECT NULLIF(LTRIM(RTRIM(ISNULL([合同号],N''))),N'') FROM [生产制单] WHERE [生产单号]=@mo",
                new { mo }, tx))?.Trim();
        if (string.IsNullOrEmpty(no))
            throw new ArgumentException("半成品入仓单必须绑定合同号（订单单号）：请填写订单单号，或指定带合同号的生产单号。");
        return no;
    }

    public async Task<string> CreateAsync(SemiReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("半成品入仓至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = dto.日期?.Date ?? DateTime.Now;
        var supplierCode = string.IsNullOrWhiteSpace(dto.供应商编号) ? null : dto.供应商编号.Trim();
        var 数量 = dto.明细.Sum(l => l.数量);
        var 金额 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        // 计划数量封顶:同一生产单+配件的已审核入仓累计+本次不得超 生产制单.计划数量(可分多次累积入仓)
        await CheckPlanCapAsync(c, tx, dto.明细, null);
        var 订单单号 = await Bind订单单号Async(c, dto, tx);
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [半成品入仓单]([单号],[订单单号],[日期],[供应商编号],[供应商名称],[部门],[生产单号],[款号],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@订单单号,@日期,@供应商编号,@供应商名称,@部门,@生产单号,@款号,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 订单单号, 日期 = now, 供应商编号 = supplierCode, dto.供应商名称, dto.部门, dto.生产单号, dto.款号, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [半成品入仓明细单]([单号],[订单单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[客户],[货号],[名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@订单单号,@日期,@供应商编号,@供应商名称,@仓库,@生产单号,@款号,@客户,@货号,@名称,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                new
                {
                    单号, 订单单号 = l.订单单号 ?? 订单单号, 日期 = now, 供应商编号 = supplierCode, dto.供应商名称, dto.仓库,
                    生产单号 = l.生产单号 ?? dto.生产单号, 款号 = l.产品货号 ?? dto.款号, l.客户,
                    货号 = l.产品货号 ?? dto.款号, 名称 = l.产品名称,
                    物料编号 = l.配件编号 ?? l.物料编号, 物料名称 = l.产品装配名称 ?? l.物料名称,
                    l.规格, l.颜色, l.单位, l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m), l.备注
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<bool> UpdateAsync(string 单号, SemiReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("半成品入仓至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var date = dto.日期?.Date ?? DateTime.Now;
        var supplierCode = string.IsNullOrWhiteSpace(dto.供应商编号) ? null : dto.供应商编号.Trim();
        var quantity = dto.明细.Sum(line => line.数量);
        var amount = dto.明细.Sum(line => line.数量 * (line.单价 ?? 0m));
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT ISNULL([审核],'0') FROM [半成品入仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is null) return false;
        if (audit == "1") throw new InvalidOperationException("已审核的半成品入仓单不能修改，请先反审核。");
        await CheckPlanCapAsync(c, tx, dto.明细, 单号);
        var 订单单号 = await Bind订单单号Async(c, dto, tx);
        await c.ExecuteAsync(@"UPDATE [半成品入仓单] SET [订单单号]=@订单单号,[日期]=@日期,[供应商编号]=@供应商编号,[供应商名称]=@供应商名称,
[部门]=@部门,[生产单号]=@生产单号,[款号]=@款号,[仓库]=@仓库,[数量]=@数量,[金额]=@金额,[操作员]=@操作员,[备注]=@备注 WHERE [单号]=@单号",
            new { 单号, 订单单号, 日期 = date, 供应商编号 = supplierCode, dto.供应商名称, dto.部门, dto.生产单号, dto.款号, dto.仓库, 数量 = quantity, 金额 = amount, 操作员 = user, dto.备注 }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        foreach (var line in dto.明细)
            await c.ExecuteAsync(@"INSERT INTO [半成品入仓明细单]([单号],[订单单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[客户],[货号],[名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@订单单号,@日期,@供应商编号,@供应商名称,@仓库,@生产单号,@款号,@客户,@货号,@名称,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)", new
            {
                单号, 订单单号 = line.订单单号 ?? 订单单号, 日期 = date, 供应商编号 = supplierCode, dto.供应商名称, dto.仓库,
                生产单号 = line.生产单号 ?? dto.生产单号, 款号 = line.产品货号 ?? dto.款号, line.客户,
                货号 = line.产品货号 ?? dto.款号, 名称 = line.产品名称, 物料编号 = line.配件编号 ?? line.物料编号,
                物料名称 = line.产品装配名称 ?? line.物料名称, line.规格, line.颜色, line.单位, line.数量,
                单价 = line.单价 ?? 0m, 金额 = line.数量 * (line.单价 ?? 0m), line.备注
            }, tx);
        tx.Commit();
        return true;
    }

    // 审核前校验(控制器在 posting.ApproveAsync 之前调用):从库里取明细走同一套封顶规则
    public async Task ValidatePlanCapAsync(string 单号)
    {
        using var c = factory.Create();
        var lines = (await c.QueryAsync<SemiReceiptLineDto>(
            "SELECT [生产单号],[物料编号],[数量] FROM [半成品入仓明细单] WHERE [单号]=@单号", new { 单号 })).AsList();
        await CheckPlanCapAsync(c, null, lines, 单号);
    }

    // 计划数量封顶:同一生产单+配件的已审核入仓累计+本次不得超 生产制单.计划数量(可分多次累积入仓);
    // 明细无生产单号或生产单不存在(无计划数量)则不封顶。
    private static async Task CheckPlanCapAsync(System.Data.IDbConnection c, System.Data.IDbTransaction? tx,
        IEnumerable<SemiReceiptLineDto> lines, string? exclude单号)
    {
        var groups = lines
            .Where(l => !string.IsNullOrWhiteSpace(l.生产单号) && !string.IsNullOrWhiteSpace(l.配件编号 ?? l.物料编号))
            .GroupBy(l => (生产单号: l.生产单号!.Trim(), 物料: (l.配件编号 ?? l.物料编号)!.Trim()));
        foreach (var g in groups)
        {
            var plan = await c.ExecuteScalarAsync<decimal?>(
                "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@mo", new { mo = g.Key.生产单号 }, tx);
            if (plan is null) continue;
            var done = await c.ExecuteScalarAsync<decimal>(@"SELECT ISNULL(SUM(d.[数量]),0) FROM [半成品入仓明细单] d
JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND d.[生产单号]=@mo AND d.[物料编号]=@mat AND d.[单号]<>@ex",
                new { mo = g.Key.生产单号, mat = g.Key.物料, ex = exclude单号 ?? "" }, tx);
            var cur = g.Sum(l => l.数量);
            if (done + cur > plan)
                throw new ArgumentException($"生产单号 {g.Key.生产单号} 配件 {g.Key.物料} 累计入半成品不能超过计划数量：计划 {plan}，已入 {done}，本次 {cur}。");
        }
    }

    // 齐套检查:半成品定义(半成品设置+明细,按名称命中、优先同货号)的每个组成物料,
    // 需要量=使用数量×本次入仓数量;已回=该生产单号下已审核塑胶入仓(外发加工回仓)累计;还差=max(0,需要-已回)。
    // 无定义(非半成品行)返回 有定义=false;无生产单号时 已回 按 0 计(无法核销,全部算欠缺)。
    public async Task<SemiKitCheckDto> KitCheckAsync(string 半成品, string? 货号, string? 生产单号, decimal 数量)
    {
        var result = new SemiKitCheckDto();
        var name = 半成品.Trim();
        using var c = factory.Create();
        var headId = await c.ExecuteScalarAsync<long?>(@"
SELECT TOP (1) h.[ID] FROM [半成品设置] h
WHERE h.[名称]=@name
ORDER BY CASE WHEN h.[货号]=@货号 THEN 0 WHEN ISNULL(h.[货号],N'')=N'' THEN 1 ELSE 2 END, h.[ID] DESC",
            new { name, 货号 = 货号?.Trim() ?? "" });
        if (headId is null) return result;
        result.有定义 = true;

        var comps = (await c.QueryAsync<(string? 物料编号, string? 物料名称, string? 单位, decimal 使用数量)>(
            "SELECT [物料编号],[物料名称],[单位],[使用数量] FROM [半成品设置明细] WHERE [头ID]=@id",
            new { id = headId.Value })).AsList();

        var codes = comps.Select(x => x.物料编号?.Trim()).Where(s => !string.IsNullOrEmpty(s)).Distinct().ToArray();
        var returned = new Dictionary<string, decimal>();
        if (codes.Length > 0 && !string.IsNullOrWhiteSpace(生产单号))
            foreach (var r in await c.QueryAsync<(string 物料编号, decimal 已回)>(@"
SELECT d.[物料编号], SUM(d.[数量]) AS [已回]
FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],N'0')=N'1' AND d.[生产单号]=@mo AND d.[物料编号] IN @codes
GROUP BY d.[物料编号]", new { mo = 生产单号.Trim(), codes }))
                returned[r.物料编号.Trim()] = r.已回;

        foreach (var comp in comps)
        {
            var 需要 = comp.使用数量 * 数量;
            var 已回 = comp.物料编号 is not null && returned.TryGetValue(comp.物料编号.Trim(), out var v) ? v : 0m;
            result.组成.Add(new SemiKitCheckLineDto
            {
                物料编号 = comp.物料编号,
                物料名称 = comp.物料名称,
                单位 = comp.单位,
                每件用量 = comp.使用数量,
                需要 = 需要,
                已回 = 已回,
                还差 = Math.Max(0m, 需要 - 已回),
            });
        }
        result.齐套 = result.组成.All(x => x.还差 <= 0);
        return result;
    }

    public async Task<SemiReceiptDetailDto?> GetAdjacentAsync(string 单号, string direction)
    {
        using var c = factory.Create();
        var next = direction.Equals("next", StringComparison.OrdinalIgnoreCase);
        var adjacent = await c.ExecuteScalarAsync<string?>(next
            ? "SELECT TOP (1) [单号] FROM [半成品入仓单] WHERE [ID] > (SELECT [ID] FROM [半成品入仓单] WHERE [单号]=@单号) ORDER BY [ID]"
            : "SELECT TOP (1) [单号] FROM [半成品入仓单] WHERE [ID] < (SELECT [ID] FROM [半成品入仓单] WHERE [单号]=@单号) ORDER BY [ID] DESC", new { 单号 });
        return adjacent is null ? null : await GetAsync(adjacent);
    }

    public async Task<PagedResult<SemiReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [订单单号] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[订单单号],[供应商编号],[供应商名称],[部门],[生产单号],[款号],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [订单单号] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiReceiptHeaderDto>()).AsList();
        return new PagedResult<SemiReceiptHeaderDto>(items, total);
    }

    public async Task<SemiReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[订单单号],[供应商编号],[供应商名称],[部门],[生产单号],[款号],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [半成品入仓单] WHERE [单号]=@单号;
SELECT [ID],[订单单号],[生产单号],[客户],COALESCE([货号],[款号]) AS [产品货号],[名称] AS [产品名称],
       [物料编号] AS [配件编号],[物料名称] AS [产品装配名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注]
FROM [半成品入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SemiReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiReceiptLineRowDto>()).AsList();
        return new SemiReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
