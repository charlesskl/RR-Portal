using System.ComponentModel.DataAnnotations.Schema;
using System.Reflection;
using Dapper;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Plastics;

// The existing generic master API delegates only raw-material writes here.
// Its mapped columns and old price semantics stay intact; raw identities/units cannot rewrite saved facts.
public sealed class RawMaterialMasterWritePolicy(ISqlConnectionFactory factory, IAuditLogger audit)
{
    private const string Menu="塑胶原料资料表";
    private static readonly PropertyInfo[] Fields=typeof(塑胶原料资料).GetProperties()
        .Where(p=>p.Name!="ID" && p.GetCustomAttribute<ColumnAttribute>() is not null).ToArray();
    public async Task<塑胶原料资料?> SaveAsync(long? id,塑胶原料资料 value,string user)
    {
        value.物料编号=value.物料编号?.Trim();
        using var c=factory.Create();await c.OpenAsync();using var tx=c.BeginTransaction();
        var old=id.HasValue?await c.QuerySingleOrDefaultAsync<塑胶原料资料>("SELECT * FROM [塑胶原料资料] WHERE [ID]=@id",new{id},tx):null;
        if(id.HasValue&&old is null)return null;
        await RawMaterialInventorySql.LockCodesAsync(c,tx,new[]{old?.物料编号,value.物料编号}.OfType<string>());
        await PlasticRawRecipeService.LockRecipesAsync(c,tx,true);
        var originalCode=old?.物料编号;
        if(id.HasValue)
        {
            old=await c.QuerySingleOrDefaultAsync<塑胶原料资料>("SELECT * FROM [塑胶原料资料] WITH(UPDLOCK,HOLDLOCK) WHERE [ID]=@id",new{id},tx);
            if(old is null)return null;
            if(old.物料编号!=originalCode)throw new InvalidOperationException("原料编号正在修改，请重新打开后保存。");
        }
        await RawMaterialTransactionPermissions.RequireAsync(c,tx,user,Menu,PermissionAction.保存);
        var actor=await RawMaterialActorAccess.ResolveAsync(c,tx,user);
        var price=actor.EffectivePermissions.GetValueOrDefault(Menu)?.单价==true;
        if(!price){value.单价=old?.单价;value.销售价=old?.销售价;}
        if(old is not null)
        {
            value.常用原料??=old.常用原料;
            if(old.物料编号!=value.物料编号||old.单位!=value.单位||old.每包重量!=value.每包重量)
            {
                var used=await c.ExecuteScalarAsync<int>("""
SELECT CASE WHEN EXISTS(SELECT 1 FROM [塑胶采购原料用量] WHERE [原料ID]=@id)
 OR EXISTS(SELECT 1 FROM [原料自动扣料期初] WHERE [原料编号]=@code)
 OR EXISTS(SELECT 1 FROM [原料采购订单明细] WHERE [原料编号]=@code AND [采购政策版本] IS NOT NULL)
 OR EXISTS(SELECT 1 FROM [原料出库明细单] WHERE [原料编号]=@code AND [来源啤机采购单号] IS NOT NULL)
 OR EXISTS(SELECT 1 FROM [塑胶原料配方明细] WHERE [原料ID]=@id OR [配方原料ID]=@id)
 THEN 1 ELSE 0 END
""",new{id,code=old.物料编号},tx);
                if(used==1)throw new InvalidOperationException("原料已被冻结用料、库存或配方引用，不能修改编号、库存单位或每包重量；请保留历史身份。");
            }
        }
        if(!string.IsNullOrWhiteSpace(value.物料编号)&&await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [塑胶原料资料] WITH(UPDLOCK,HOLDLOCK) WHERE [物料编号]=@code AND [ID]<>@id",new{code=value.物料编号,id=id??0},tx)>0)
            throw new InvalidOperationException("原料编号已存在，请使用唯一真实原料编号。");
        var args=new DynamicParameters(value);args.Add("id",id);
        if(id.HasValue)
            await c.ExecuteAsync("UPDATE [塑胶原料资料] SET "+string.Join(",",Fields.Select(p=>$"[{p.Name}]=@{p.Name}"))+" WHERE [ID]=@id",args,tx);
        else
            value.ID=await c.ExecuteScalarAsync<long>("INSERT INTO [塑胶原料资料]("+string.Join(",",Fields.Select(p=>$"[{p.Name}]"))+") OUTPUT INSERTED.[ID] VALUES("+string.Join(",",Fields.Select(p=>"@"+p.Name))+")",args,tx);
        await audit.WriteAsync("塑胶原料资料",id.HasValue?"修改":"新增",user,$"ID={id??value.ID}",c,tx);tx.Commit();return value;
    }
    public async Task<bool> DeleteAsync(long id,string user)
    {
        using var c=factory.Create();await c.OpenAsync();using var tx=c.BeginTransaction();
        var code=await c.ExecuteScalarAsync<string?>("SELECT [物料编号] FROM [塑胶原料资料] WHERE [ID]=@id",new{id},tx);
        await RawMaterialInventorySql.LockCodesAsync(c,tx,new[]{code}.OfType<string>());
        await PlasticRawRecipeService.LockRecipesAsync(c,tx,true);
        await RawMaterialTransactionPermissions.RequireAsync(c,tx,user,Menu,PermissionAction.删除);
        var current=await c.QuerySingleOrDefaultAsync<塑胶原料资料>("SELECT * FROM [塑胶原料资料] WITH(UPDLOCK,HOLDLOCK) WHERE [ID]=@id",new{id},tx);
        if(current is null)return false;
        if(current.物料编号!=code)throw new InvalidOperationException("原料编号正在修改，请重新打开后删除。");
        if(await c.ExecuteScalarAsync<int>("""
SELECT CASE WHEN EXISTS(SELECT 1 FROM [塑胶采购原料用量] WHERE [原料ID]=@id)
 OR EXISTS(SELECT 1 FROM [原料自动扣料期初] WHERE [原料编号]=@code)
 OR EXISTS(SELECT 1 FROM [原料采购订单明细] WHERE [原料编号]=@code AND [采购政策版本] IS NOT NULL)
 OR EXISTS(SELECT 1 FROM [原料出库明细单] WHERE [原料编号]=@code AND [来源啤机采购单号] IS NOT NULL)
 OR EXISTS(SELECT 1 FROM [塑胶原料配方] WHERE [原料ID]=@id)
 OR EXISTS(SELECT 1 FROM [塑胶原料配方明细] WHERE [原料ID]=@id OR [配方原料ID]=@id)
 THEN 1 ELSE 0 END
""",new{id,code},tx)==1)throw new InvalidOperationException("原料已被冻结用料、库存或配方引用，不能删除。");
        await c.ExecuteAsync("DELETE FROM [塑胶原料资料] WHERE [ID]=@id",new{id},tx);
        await audit.WriteAsync("塑胶原料资料","删除",user,$"ID={id}",c,tx);tx.Commit();return true;
    }

}
