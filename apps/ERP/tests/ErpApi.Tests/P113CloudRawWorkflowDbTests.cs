using System.Security.Claims;
using Dapper;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;
using ErpApi.Features.Plastics.PlasticRawMaterialReceipt;
using ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
using ErpApi.Integrations.SprayPlan;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

[Collection("db")]
public sealed class P113CloudRawWorkflowDbTests(DbFixture fx)
{
    [Fact]
    public async Task New_SP_freezes_net_material_then_split_issues_reserve_and_only_keeper_posting_changes_stock()
    {
        using var c = fx.Open(); using var s = new CloudRawFixture(c, fx.ConnectionString!);
        var sp = await s.NewSource();
        Assert.Equal(12m, await s.Stock());
        var source = Assert.Single((await s.Issues.SourceAsync(sp))!.明细);
        Assert.Equal(28m, source.需求数量KG); Assert.Equal(1m, source.每库存单位KG);
        c.Execute("UPDATE [塑胶物料资料] SET [整啤净重]=2000 WHERE [物料编号]=@Plastic", s);
        Assert.Equal(28m, Assert.Single((await s.Issues.SourceAsync(sp))!.明细).需求数量KG);
        Assert.Equal(16m, Assert.Single(await RawMaterialProcurementPolicy.ReadAnalysisAsync(c, null, keyword:s.Raw)).缺口数量KG);
        var one = await s.Issues.CreateAsync(s.Issue(sp,8), s.Clerk);
        var two = await s.Issues.CreateAsync(s.Issue(sp,20), s.Clerk);
        await Assert.ThrowsAsync<InvalidOperationException>(() => s.Issues.CreateAsync(s.Issue(sp,1), s.Clerk));
        Assert.Equal(0m, Assert.Single((await s.Issues.SourceAsync(sp))!.明细).可申请数量);
        await Assert.ThrowsAsync<InvalidOperationException>(() => s.Posting.ApproveAsync("原料出库单",one,s.Keeper));
        await s.Approvals.SupervisorApproveAsync(one,s.Supervisor);
        await s.Approvals.ManagerApproveAsync(one,s.Manager);
        var message = Assert.Single(c.Query<(string User,string Number)>("SELECT [接收人] AS [User],[单号] AS Number FROM [消息] WHERE [类型]=N'原料领料待出库' AND [单号]=@one",new {one}));
        Assert.Equal(s.Keeper,message.User); Assert.Equal(one,message.Number);
        Assert.Equal(12m,await s.Stock());
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Posting.ApproveAsync("原料出库单",one,s.Manager));
        Assert.True(await s.Posting.ApproveAsync("原料出库单",one,s.Keeper)); Assert.Equal(4m,await s.Stock());
        await s.Approvals.SupervisorApproveAsync(two,s.Supervisor); await s.Approvals.ManagerApproveAsync(two,s.Manager);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Posting.ApproveAsync("原料出库单",two,s.Keeper));
        Assert.Equal("0",(await s.Issues.GetAsync(two))!.单头!.审核); Assert.Equal(4m,await s.Stock());
        Assert.True(await s.Posting.UnapproveAsync("原料出库单",one,s.WarehouseManager)); Assert.Equal(12m,await s.Stock());
        var head=(await s.Issues.GetAsync(one))!.单头!; Assert.Equal("0",head.主管审核);Assert.Equal("0",head.经理审核);
        Assert.Equal(0m,Assert.Single((await s.Issues.SourceAsync(sp))!.明细).可申请数量);
        await s.Issues.DeleteAsync(one,s.Clerk);Assert.Equal(8m,Assert.Single((await s.Issues.SourceAsync(sp))!.明细).可申请数量);
    }

    [Fact]
    public async Task Concurrent_source_requests_cannot_exceed_frozen_quantity_and_wrong_unit_is_rejected()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);var sp=await s.NewSource();
        var bad=s.Issue(sp,1);bad.明细[0].单位="包";bad.明细[0].每包重量=25;
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Issues.CreateAsync(bad,s.Clerk));
        var wrong=s.Issue(sp,1);wrong.明细[0].原料编号=s.Plastic;
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Issues.CreateAsync(wrong,s.Clerk));
        async Task<bool> Save(){try{await s.Issues.CreateAsync(s.Issue(sp,20),s.Clerk);return true;}catch(InvalidOperationException e)when(e.Message.Contains("累计申请")){return false;}}
        Assert.Single((await Task.WhenAll(Save(),Save())).Where(x=>x));
        Assert.Equal(20m,Assert.Single((await s.Issues.SourceAsync(sp))!.明细).已申请数量);Assert.Equal(12m,await s.Stock());
    }

    [Fact]
    public async Task Missing_recipients_or_failed_audit_rolls_back_manager_stage_and_message()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);var sp=await s.NewSource();
        var issue=await s.Issues.CreateAsync(s.Issue(sp,1),s.Clerk);await s.Approvals.SupervisorApproveAsync(issue,s.Supervisor);
        c.Execute("UPDATE [userbqrpower] SET [审核]=0 WHERE [用户]=@Keeper AND [菜单]=N'原料出库表'",s);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Approvals.ManagerApproveAsync(issue,s.Manager));
        Assert.NotEqual("1",(await s.Issues.GetAsync(issue))!.单头!.经理审核);
        c.Execute("UPDATE [userbqrpower] SET [审核]=1 WHERE [用户]=@Keeper AND [菜单]=N'原料出库表'",s);
        var broken=new PlasticRawMaterialIssueApprovalService(s.Factory,new PermissionService(s.Factory),new BrokenAudit());
        await Assert.ThrowsAsync<InvalidOperationException>(()=>broken.ManagerApproveAsync(issue,s.Manager));
        Assert.NotEqual("1",(await s.Issues.GetAsync(issue))!.单头!.经理审核);
        Assert.Equal(0,c.ExecuteScalar<int>("SELECT COUNT(*) FROM [消息] WHERE [单号]=@issue",new {issue}));
        await s.Approvals.ManagerApproveAsync(issue,s.Manager);
        Assert.Equal(1,c.ExecuteScalar<int>("SELECT COUNT(*) FROM [消息] WHERE [单号]=@issue",new {issue}));
    }

    [Fact]
    public async Task Dedicated_role_binding_never_grants_matrix_permission_and_management_audits_explicit_account()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);
        var controller=new RawMaterialWorkflowController(s.Factory,new PermissionService(s.Factory),new AuditLogger())
        {ControllerContext=new(){HttpContext=new DefaultHttpContext{User=new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier,s.Clerk)],"test"))}}};
        Assert.IsType<ForbidResult>(await controller.SaveRole(s.Clerk,new("06-manager")));
        c.Execute("INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存]) VALUES(@Clerk,N'账号管理',1,1)",s);
        Assert.IsType<NoContentResult>(await controller.SaveRole(s.Clerk,new("06-manager")));
        Assert.Equal("06-manager",(await RawMaterialActorAccess.ResolveAsync(c,null,s.Clerk)).PositionCode);
        c.Execute("UPDATE [userbqrpower] SET [审核]=0 WHERE [用户]=@Clerk AND [菜单]=N'原料出库表'",s);
        Assert.False(await new PermissionService(s.Factory).HasAsync(s.Clerk,"原料出库表",PermissionAction.审核));
        Assert.Equal(1,c.ExecuteScalar<int>("SELECT COUNT(*) FROM [c操作记录] WHERE [表名]=N'原料流程岗位绑定' AND [操作员]=@Clerk",s));
        Assert.IsType<NoContentResult>(await controller.SaveRole(s.Clerk,new(null)));
        Assert.Null((await RawMaterialActorAccess.ResolveAsync(c,null,s.Clerk)).PositionCode);
    }

    [Fact]
    public async Task Common_flag_write_preserves_hidden_price_and_frozen_identity_and_rechecks_revocation()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);
        c.Execute("INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价]) VALUES(@Clerk,N'塑胶原料资料表',1,1,1,0); UPDATE [塑胶原料资料] SET [单价]=8 WHERE [物料编号]=@Raw",s);
        var service=new RawMaterialMasterWritePolicy(s.Factory,new AuditLogger());
        var row=c.QuerySingle<塑胶原料资料>("SELECT * FROM [塑胶原料资料] WHERE [物料编号]=@Raw",s);
        row.常用原料=true;row.单价=99;await service.SaveAsync(row.ID,row,s.Clerk);
        Assert.Equal(8m,c.ExecuteScalar<decimal>("SELECT [单价] FROM [塑胶原料资料] WHERE [ID]=@ID",row));
        Assert.True(c.ExecuteScalar<bool>("SELECT [常用原料] FROM [塑胶原料资料] WHERE [ID]=@ID",row));
        await s.NewSource();row.单位="包";
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.SaveAsync(row.ID,row,s.Clerk));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.DeleteAsync(row.ID,s.Clerk));
        row.单位="KG";row.常用原料=false;
        c.Execute("UPDATE [userbqrpower] SET [保存]=0 WHERE [用户]=@Clerk AND [菜单]=N'塑胶原料资料表'",s);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.SaveAsync(row.ID,row,s.Clerk));
        Assert.True(c.ExecuteScalar<bool>("SELECT [常用原料] FROM [塑胶原料资料] WHERE [ID]=@ID",row));
        Assert.Equal(12m,await s.Stock());
    }

    [Fact]
    public async Task First_new_purchase_receipt_preserves_master_opening_and_receipt_reversal_cannot_undercut_issued_stock()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);var sp=await s.NewSource();
        var purchase=new PlasticRawMaterialPurchaseOrderService(s.Factory,s.NumberGenerator);
        var order=await purchase.CreateAsync(new(){明细=[new(){原料编号=s.Raw,单位="KG",订货数量=16}]},s.Clerk);
        c.Execute("UPDATE [原料采购订单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@order",new{order});
        await s.Posting.ApproveAsync("原料采购订单",order,s.Clerk);
        var receipts=new PlasticRawMaterialReceiptService(s.Factory,s.NumberGenerator);
        var number=await receipts.CreateAsync(new(){订单单号=order,明细=[new(){原料编号=s.Raw,单位="KG",每包重量=25,数量=16}]},s.Clerk);
        Assert.Equal(12m,await s.Stock());
        Assert.True(await s.Posting.ApproveAsync("原料入仓单",number,s.Keeper));Assert.Equal(28m,await s.Stock());
        Assert.Equal(12m,c.ExecuteScalar<decimal>("SELECT [期初数量] FROM [原料自动扣料期初] WHERE [原料编号]=@Raw",s));
        var issue=await s.Issues.CreateAsync(s.Issue(sp,28),s.Clerk);await s.Approvals.SupervisorApproveAsync(issue,s.Supervisor);await s.Approvals.ManagerApproveAsync(issue,s.Manager);
        await s.Posting.ApproveAsync("原料出库单",issue,s.Keeper);Assert.Equal(0m,await s.Stock());
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Posting.UnapproveAsync("原料入仓单",number,s.Keeper));Assert.Equal(0m,await s.Stock());
        await s.Posting.UnapproveAsync("原料出库单",issue,s.WarehouseManager);await s.Posting.UnapproveAsync("原料入仓单",number,s.Keeper);
        Assert.Equal(12m,await s.Stock());
    }

    [Fact]
    public async Task New_purchase_receipts_recheck_frozen_unit_and_concurrent_remaining_order_quantity()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);await s.NewSource();
        var purchase=new PlasticRawMaterialPurchaseOrderService(s.Factory,s.NumberGenerator);
        var order=await purchase.CreateAsync(new(){明细=[new(){原料编号=s.Raw,单位="KG",订货数量=16}]},s.Clerk);
        var receipts=new PlasticRawMaterialReceiptService(s.Factory,s.NumberGenerator);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>receipts.CreateAsync(new(){订单单号=order,明细=[new(){原料编号=s.Raw,单位="包",每包重量=25,数量=1}]},s.Clerk));
        var a=await receipts.CreateAsync(new(){订单单号=order,明细=[new(){原料编号=s.Raw,单位="KG",数量=10}]},s.Clerk);
        var b=await receipts.CreateAsync(new(){订单单号=order,明细=[new(){原料编号=s.Raw,单位="KG",数量=10}]},s.Clerk);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Posting.ApproveAsync("原料入仓单",a,s.Keeper));
        Assert.Equal(12m,await s.Stock());
        c.Execute("UPDATE [原料采购订单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@order",new{order});
        await s.Posting.ApproveAsync("原料采购订单",order,s.Clerk);
        async Task<bool> Post(string number){try{return await s.Posting.ApproveAsync("原料入仓单",number,s.Keeper);}catch(InvalidOperationException e)when(e.Message.Contains("累计入仓")){return false;}}
        Assert.Single((await Task.WhenAll(Post(a),Post(b))).Where(x=>x));Assert.Equal(22m,await s.Stock());
    }

    [Fact]
    public async Task New_source_edit_resets_stages_but_explicit_old_NULL_save_keeps_legacy_identity()
    {
        using var c=fx.Open();using var s=new CloudRawFixture(c,fx.ConnectionString!);
        var body=new PlasticPurchaseOrderCreateDto(){明细=[new(){物料编号=s.Plastic,数量=28}]};
        var sp=await s.Orders.CreateAsync(body,s.Clerk);
        c.Execute("UPDATE [塑胶采购订单] SET [主管审核]=N'1',[经理审核]=N'1',[主管审核人]=@Supervisor,[经理审核人]=@Manager WHERE [单号]=@sp",new{sp,s.Supervisor,s.Manager});
        body.明细[0].数量=30;await s.Orders.UpdateAsync(sp,body,s.Clerk);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>s.Posting.ApproveAsync("塑胶采购订单",sp,s.Manager));
        Assert.Equal(30m,Assert.Single((await RawMaterialProcurementPolicy.ReadMoldingSourceAsync(c,null,sp))!.明细).需求数量KG);
        var old=s.Prefix+"OLD";
        c.Execute("INSERT INTO [塑胶采购订单]([单号],[审核],[加工类型]) VALUES(@old,N'0',N'一次加工'); INSERT INTO [塑胶采购订单明细]([单号],[物料编号],[数量],[原料用量KG]) VALUES(@old,@Plastic,2,2)",new{old,s.Plastic});
        await s.Orders.UpdateAsync(old,body,s.Clerk);
        Assert.Null(c.ExecuteScalar<int?>("SELECT [原料扣减版本] FROM [塑胶采购订单] WHERE [单号]=@old",new{old}));
        Assert.Equal(0,c.ExecuteScalar<int>("SELECT COUNT(*) FROM [塑胶采购原料用量] WHERE [采购单号]=@old",new{old}));
        Assert.False((await RawMaterialProcurementPolicy.ReadMoldingSourceAsync(c,null,old))!.单头.快照有效);
    }

    private sealed class BrokenAudit:IAuditLogger
    { public Task WriteAsync(string t,string a,string u,string d,SqlConnection c,SqlTransaction? tx=null)=>throw new InvalidOperationException("fixture-audit-failure"); }
}

// Reusable isolated fixture; documents use a per-instance prefix and no real number sequence.
public sealed class CloudRawFixture:IDisposable
{
    private readonly SqlConnection c;
    public string Prefix {get;}="P113C"+Guid.NewGuid().ToString("N")[..8];
    public string Like=>Prefix+"%";
    public string Raw=>Prefix+"R";public string Plastic=>Prefix+"P";public string Mold=>Prefix+"G";
    private string Actor(string suffix)=>Prefix[5..]+suffix;
    public string Clerk=>Actor("C");public string Supervisor=>Actor("S");public string Manager=>Actor("M");public string Keeper=>Actor("K");public string WarehouseManager=>Actor("W");
    public string[] Users=>[Clerk,Supervisor,Manager,Keeper,WarehouseManager];
    public ISqlConnectionFactory Factory {get;}
    public IDocumentNumberGenerator NumberGenerator=>numbers;
    public PlasticRawMaterialStockIssueService Issues {get;}
    public PlasticRawMaterialIssueApprovalService Approvals {get;}
    public PostingEngine Posting {get;}
    public PlasticPurchaseOrderService Orders {get;}
    private readonly List<string> addedDepartments=[];
    private readonly Numbers numbers;
    public CloudRawFixture(SqlConnection c,string connectionString)
    {
        this.c=c;Factory=new ConnectionFactory(connectionString);numbers=new(Prefix);
        foreach(var department in new[]{"05","06"})if(c.ExecuteScalar<int>("SELECT COUNT(*) FROM [部门信息] WHERE [编号]=@department",new{department})==0)
        {c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(@department,@name)",new{department,name=Prefix});addedDepartments.Add(department);}
        foreach(var pair in new[]{(Clerk,"06-clerk"),(Supervisor,"06-supervisor"),(Manager,"06-manager"),(Keeper,"05-warehouse"),(WarehouseManager,"05-manager")})
        {
            var role=RawMaterialActorAccess.Roles[pair.Item2];
            c.Execute("""
INSERT INTO [sysfileuser]([用户],[密码],[登录状态],[登录失败次数]) VALUES(@user,N'test-only-not-login',N'',0);
INSERT INTO [原料流程岗位绑定]([用户ID],[部门编号],[岗位代码],[所属仓库]) SELECT [ID],@department,@position,@warehouse FROM [sysfileuser] WHERE [用户]=@user;
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[审核],[反审核],[单价],[金额]) VALUES(@user,@user,N'原料出库表',1,1,1,1,1,1,1),(@user,@user,N'塑胶采购订单',1,1,1,1,1,1,1),(@user,@user,N'原料采购订单',1,1,1,1,1,1,1),(@user,@user,N'原料入仓单',1,1,1,1,1,1,1);
""",new{user=pair.Item1,position=pair.Item2,department=role.Department,warehouse=role.Warehouse});
        }
        c.Execute("""
INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[每包重量],[库存],[常用原料]) VALUES(@Raw,@Raw,N'KG',25,12,0);
INSERT INTO [工模表]([工模编号],[工模名称]) VALUES(@Mold,@Mold);
INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位],[工模编号],[用料名称],[套数],[出模数],[整啤净重]) VALUES(@Plastic,@Plastic,N'件',@Mold,@Raw,1,1,1000);
""",this);
        Issues=new(Factory,numbers);Approvals=new(Factory,new PermissionService(Factory),new AuditLogger());Posting=new(Factory,new AuditLogger());
        Orders=new(Factory,numbers,new PaijiPushService(new HttpClient(),Options.Create(new PaijiOptions()),NullLogger<PaijiPushService>.Instance),
            new SprayPlanPushService(new HttpClient(),Options.Create(new SprayPlanOptions()),Options.Create(new PaijiOptions()),NullLogger<SprayPlanPushService>.Instance),new PlasticInventoryService(Factory));
    }
    public async Task<string> NewSource()
    {
        var sp=await Orders.CreateAsync(new(){供应商名称=Prefix,明细=[new(){物料编号=Plastic,数量=28,套数=1}]},Clerk);
        c.Execute("UPDATE [塑胶采购订单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@sp",new{sp});
        await Posting.ApproveAsync("塑胶采购订单",sp,Manager);return sp;
    }
    public PlasticRawMaterialStockIssueCreateDto Issue(string source,decimal quantity)=>new(){生产车间=Prefix,制单人=Clerk,明细=[new(){来源啤机采购单号=source,原料编号=Raw,原料名称=Raw,单位="KG",每包重量=1,数量=quantity}]};
    public Task<decimal> Stock()=>RawMaterialInventorySql.StockAsync(c,null,Raw);
    public void Dispose()
    {
        c.Execute("DELETE FROM [消息] WHERE [单号] LIKE @Like; DELETE FROM [c操作记录] WHERE [操作员] IN @Users",this);
        foreach(var table in new[]{"原料出库明细单","原料出库单","原料入仓明细单","原料入仓单","原料采购订单明细","原料采购订单"})c.Execute($"DELETE FROM [{table}] WHERE [单号] LIKE @Like",this);
        c.Execute("""
DELETE FROM [塑胶采购原料用量] WHERE [采购单号] LIKE @Like;
DELETE FROM [塑胶采购订单明细] WHERE [单号] LIKE @Like;DELETE FROM [塑胶采购订单] WHERE [单号] LIKE @Like;
DELETE FROM [原料自动扣料期初] WHERE [原料编号]=@Raw;
DELETE FROM [塑胶物料资料] WHERE [物料编号]=@Plastic;DELETE FROM [工模表] WHERE [工模编号]=@Mold;DELETE FROM [塑胶原料资料] WHERE [物料编号]=@Raw;
DELETE b FROM [原料流程岗位绑定] b JOIN [sysfileuser] u ON u.[ID]=b.[用户ID] WHERE u.[用户] IN @Users;
DELETE FROM [userbqrpower] WHERE [用户] IN @Users;DELETE FROM [sysfileuser] WHERE [用户] IN @Users;
""",this);
        foreach(var code in addedDepartments)c.Execute("DELETE FROM [部门信息] WHERE [编号]=@code AND [部门]=@Prefix",new{code,Prefix});
    }
    private sealed class ConnectionFactory(string value):ISqlConnectionFactory{public SqlConnection Create()=>new(value);public string GetConnectionString()=>value;}
    private sealed class Numbers(string prefix):IDocumentNumberGenerator
    {private int serial;public Task<string> NextAsync(string type,string ignored,DateTime date,SqlConnection c,SqlTransaction tx)=>Task.FromResult(prefix+ignored+Interlocked.Increment(ref serial));}
}
