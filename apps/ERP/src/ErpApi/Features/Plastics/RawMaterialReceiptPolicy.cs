using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticRawMaterialReceipt;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

// Only receipts linked to a P113 purchase opt in. Legacy source-less/old-policy receipts retain their original rules.
public static class RawMaterialReceiptPolicy
{
    private sealed record Header(string? Number,string? Audit,int? Version);
    private sealed record Line(string? 原料编号,string? 单位,decimal? 每包重量,decimal 数量,string? 备品);
    private sealed record Ordered(string? Code,string? Unit,decimal? Factor,int? Version,decimal Quantity);
    private static string Unit(string? value)=>value?.Trim().ToUpperInvariant() is "公斤"?"KG":value?.Trim().ToUpperInvariant()??"";

    public static async Task<bool> PrepareCreateAsync(SqlConnection c,SqlTransaction tx,PlasticRawMaterialReceiptCreateDto dto,string user)
    {
        if(string.IsNullOrWhiteSpace(dto.订单单号))return false;
        var version=await c.ExecuteScalarAsync<int?>("SELECT [采购政策版本] FROM [原料采购订单] WHERE [单号]=@number",new{number=dto.订单单号},tx);
        if(version!=1)return false;
        await RawMaterialInventorySql.LockCodesAsync(c,tx,dto.明细.Select(x=>x.原料编号).OfType<string>());
        var source=await SourceAsync(c,tx,dto.订单单号);
        if(source?.Version!=1)throw new InvalidOperationException("原料采购来源正在修改或已删除，请重新选择。");
        await RawMaterialTransactionPermissions.RequireAsync(c,tx,user,"原料入仓单",PermissionAction.保存);
        await ValidateLinesAsync(c,tx,dto.订单单号,dto.明细.Select(x=>new Line(x.原料编号,x.单位,x.每包重量,x.数量,x.备品)),null,false);
        return true;
    }

    public static async Task<bool> PrepareDeleteAsync(SqlConnection c,SqlTransaction tx,string number,string user)
    {
        var order=await c.ExecuteScalarAsync<string?>("SELECT [订单单号] FROM [原料入仓单] WHERE [单号]=@number",new{number},tx);
        if(string.IsNullOrWhiteSpace(order))return false;
        var version=await c.ExecuteScalarAsync<int?>("SELECT [采购政策版本] FROM [原料采购订单] WHERE [单号]=@order",new{order},tx);
        if(version!=1)return false;
        await RawMaterialInventorySql.LockDocumentAsync(c,tx,"原料入仓单",number);
        if((await SourceAsync(c,tx,order))?.Version!=1)throw new InvalidOperationException("原料采购来源正在修改，请重新打开后删除。");
        await RawMaterialTransactionPermissions.RequireAsync(c,tx,user,"原料入仓单",PermissionAction.删除);
        return true;
    }

    // Caller already holds all receipt material locks. The purchase head serializes edit/delete/final receipt.
    public static async Task PreparePostingAsync(SqlConnection c,SqlTransaction tx,string number,string user,bool approved)
    {
        var order=await c.ExecuteScalarAsync<string?>("SELECT [订单单号] FROM [原料入仓单] WHERE [单号]=@number",new{number},tx);
        if(string.IsNullOrWhiteSpace(order))return;
        var source=await SourceAsync(c,tx,order);
        if(source?.Version!=1)return;
        await RawMaterialTransactionPermissions.RequireAsync(c,tx,user,"原料入仓单",approved?PermissionAction.审核:PermissionAction.反审核);
        var receipt=await c.QuerySingleOrDefaultAsync<Header>("SELECT [订单单号] AS Number,[审核] AS Audit,CAST(NULL AS int) AS Version FROM [原料入仓单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@number",new{number},tx);
        if(receipt is null||receipt.Audit==(approved?"1":"0"))return;
        if(receipt.Number!=order)throw new InvalidOperationException("原料入仓来源正在修改，请重新打开后审核。");
        if(!approved)return;
        if(source.Audit!="1")throw new InvalidOperationException("原料采购订单尚未完成审核，不能入仓。");
        var lines=await c.QueryAsync<Line>("SELECT [原料编号],[单位],[每包重量],ISNULL([数量],0) AS 数量,[备品] FROM [原料入仓明细单] WHERE [单号]=@number",new{number},tx);
        await ValidateLinesAsync(c,tx,order,lines,number,true);
    }

    private static Task<Header?> SourceAsync(SqlConnection c,SqlTransaction tx,string number)=>c.QuerySingleOrDefaultAsync<Header>(
        "SELECT [单号] AS Number,[审核] AS Audit,[采购政策版本] AS Version FROM [原料采购订单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@number",new{number},tx);

    private static async Task ValidateLinesAsync(SqlConnection c,SqlTransaction tx,string order,IEnumerable<Line> lines,string? receipt,bool activate)
    {
        var orders=(await c.QueryAsync<Ordered>("SELECT [原料编号] AS Code,[单位] AS Unit,[每库存单位KG] AS Factor,[采购政策版本] AS Version,ISNULL([订货数量],0) AS Quantity FROM [原料采购订单明细] WHERE [单号]=@order",new{order},tx)).ToArray();
        foreach(var group in lines.GroupBy(x=>x.原料编号,StringComparer.OrdinalIgnoreCase))
        {
            var source=orders.Where(x=>string.Equals(x.Code,group.Key,StringComparison.OrdinalIgnoreCase)).ToArray();
            if(source.Length==0||string.IsNullOrWhiteSpace(group.Key))throw new InvalidOperationException("入仓原料不属于当前采购订单。");
            var unit=Unit(source[0].Unit);var factor=source[0].Factor;
            if(unit is not ("KG" or "包")||factor is not >0||unit=="KG"&&factor!=1||source.Any(x=>x.Version!=1||Unit(x.Unit)!=unit||x.Factor!=factor))
                throw new InvalidOperationException("原料采购冻结换算不完整，请核对原单。");
            if(group.Any(x=>x.数量<=0||decimal.Round(x.数量,4)!=x.数量||Unit(x.单位)!=unit||(unit=="包"&&x.每包重量!=factor)))
                throw new InvalidOperationException("入仓数量须为正且最多4位小数，单位及包重须与采购冻结换算一致。");
            var requested=group.Where(x=>x.备品!="1").Sum(x=>x.数量);
            var received=await c.ExecuteScalarAsync<decimal>("""
SELECT ISNULL(SUM(d.[数量]),0) FROM [原料入仓明细单] d JOIN [原料入仓单] h ON h.[单号]=d.[单号]
WHERE h.[订单单号]=@order AND h.[审核]=N'1' AND ISNULL(d.[备品],N'0')<>N'1' AND d.[原料编号]=@code AND (@receipt IS NULL OR h.[单号]<>@receipt)
""",new{order,code=group.Key,receipt},tx);
            if(received+requested>source.Sum(x=>x.Quantity))throw new InvalidOperationException("原料累计入仓数量超过采购订货数量。");
            // Before the first posted movement the existing master balance is the opening balance.
            // Existing ledger materials freeze zero opening, so old receipts are never counted twice.
            if(activate)await RawMaterialInventorySql.ActivateAsync(c,tx,group.Key!,unit,factor!.Value);
        }
    }
}
