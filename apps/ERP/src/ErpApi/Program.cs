using System.Text;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Features.Auth;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 基础设施
builder.Services.AddSingleton<ISqlConnectionFactory, SqlConnectionFactory>();
builder.Services.AddDbContext<ErpApi.Data.ErpDbContext>((sp, o) =>
    o.UseSqlServer(sp.GetRequiredService<ISqlConnectionFactory>().GetConnectionString()));
builder.Services.AddScoped(typeof(ErpApi.Features.MasterData.MasterCrudService<>));
builder.Services.AddScoped<ErpApi.Features.MasterData.Pricing.PricingService>();
builder.Services.AddSingleton<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();
// 4 横切引擎
builder.Services.AddScoped<IDocumentNumberGenerator, DocumentNumberGenerator>();
builder.Services.AddScoped<IPostingEngine, PostingEngine>();
builder.Services.AddScoped<PurchaseApprovalChainService>();
builder.Services.AddScoped<IInventorySummaryService, InventorySummaryService>();
builder.Services.AddScoped<IMaterialInventoryService, MaterialInventoryService>();
builder.Services.AddSingleton<IInventorySnapshotProvider, NullSnapshotProvider>();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddSingleton<IAuditLogger, AuditLogger>();
// 业务
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<ErpApi.Features.Styles.StyleService>();
builder.Services.AddScoped<ErpApi.Features.Styles.SemiSetup.SemiSetupService>();
builder.Services.AddScoped<ErpApi.Features.Assembly.AssemblyMaterialSummaryService>();
builder.Services.AddScoped<ErpApi.Features.Assembly.AssemblyPurchaseQueryService>();
builder.Services.AddScoped<ErpApi.Features.Assembly.AssemblyPurchaseOrderService>();
builder.Services.AddScoped<ErpApi.Features.Orders.OrderService>();
builder.Services.AddScoped<ErpApi.Features.Scheduling.SchedulingService>();
builder.Services.AddScoped<ErpApi.Features.Production.ProductionService>();
builder.Services.AddScoped<ErpApi.Features.Production.ProductionReportService>();
builder.Services.AddScoped<ErpApi.Features.Production.MoTrackingService>();
builder.Services.AddScoped<ErpApi.Features.Production.Replenishment.ReplenishmentService>();
builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseReceipt.PurchaseReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseOrder.PurchaseOrderService>();
builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseReturn.PurchaseReturnService>();
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialMaster.MaterialMasterService>();
builder.Services.AddScoped<ErpApi.Features.Materials.FactoryMaster.FactoryMasterService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialMaster.PlasticMaterialMasterService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialMaster.PlasticRawMaterialMasterService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticCommonMaterial.PlasticCommonMaterialService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialDoc.PlasticMaterialDocService>();
builder.Services.AddScoped<ErpApi.Engines.Inventory.PlasticInventoryService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticPurchaseOrder.PlasticPurchaseOrderService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticProcessPurchaseOrder.PlasticProcessPurchaseOrderService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticProcessDemand.PlasticProcessDemandService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticWhitePartIssue.PlasticWhitePartIssueService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialDemand.PlasticRawMaterialDemandService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder.PlasticRawMaterialPurchaseOrderService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialReceipt.PlasticRawMaterialReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialReturn.PlasticRawMaterialReturnService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialStockReturn.PlasticRawMaterialStockReturnService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialStockIssue.PlasticRawMaterialStockIssueService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialStocktake.PlasticRawMaterialStocktakeService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticReceipt.PlasticReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticIssue.PlasticIssueService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticReturn.PlasticReturnService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticWarehouseReturn.PlasticWarehouseReturnService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticScrap.PlasticScrapService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticStocktake.PlasticStocktakeService>();
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialIssue.MaterialIssueService>();
builder.Services.AddScoped<ErpApi.Features.Messages.MessageService>();
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialReturn.MaterialReturnService>();
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialScrap.MaterialScrapService>();
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialStocktake.MaterialStocktakeService>();
builder.Services.AddScoped<ErpApi.Features.Production.Cutting.CuttingService>();
builder.Services.AddScoped<ErpApi.Features.Production.Piecework.PieceworkService>();
builder.Services.AddScoped<ErpApi.Features.Production.Outsourcing.OutsourceService>();
builder.Services.AddScoped<ErpApi.Features.Production.Outsourcing.OutsourceReturnService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedIssueService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedStocktakeService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedTransferService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedSalesReturnService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedVendorReturnService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiWarehouseReturnService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiIssueService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiStockReturnService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiScrapService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiInventoryReportService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiMonthlyReportService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.Labels.SemiLabelQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiReceiptQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiWhReturnQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiIssueQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiStockReturnQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiScrapQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiStocktakeQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedReceiptQueryService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiStocktakeService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.CommonMaterials.SemiFinishedCommonMaterialService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.Labels.ISemiFinishedLabelOrderService,
    ErpApi.Features.Warehouse.Semi.Labels.SemiFinishedLabelOrderService>();
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.ShortageAnalysis.ISemiFinishedShortageService,
    ErpApi.Features.Warehouse.Semi.ShortageAnalysis.SemiFinishedShortageService>();
builder.Services.AddScoped<ErpApi.Features.MonthEnd.MonthEndService>();
builder.Services.AddScoped<ErpApi.Features.MonthEnd.PeriodLockService>();
builder.Services.AddScoped<ErpApi.Features.Sales.SalesShipmentService>();
builder.Services.AddScoped<ErpApi.Features.Sales.SalesReturnService>();
builder.Services.AddScoped<ErpApi.Features.Sales.SalesReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Sales.ReceivablesService>();
builder.Services.AddScoped<ErpApi.Features.Payables.PurchasePaymentService>();
builder.Services.AddScoped<ErpApi.Features.Payables.OutsourcePaymentService>();
builder.Services.AddScoped<ErpApi.Features.Payables.PayablesService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.PieceworkPayrollService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.AbsenceService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.AttendanceService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.WageTemplateService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.PayrollService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.PayrollQueryService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.ShiftService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.RosterService>();
builder.Services.AddScoped<ErpApi.Features.Payroll.DailyReportService>();
builder.Services.AddSingleton<ErpApi.Infrastructure.Security.IConfigProtector, ErpApi.Infrastructure.Security.ConfigProtector>();
builder.Services.AddScoped<ErpApi.Features.SystemConfig.SysConfigService>();
builder.Services.AddScoped<ErpApi.Features.Admin.AccountService>();
builder.Services.AddScoped<ErpApi.Features.Admin.PermissionAdminService>();
builder.Services.AddScoped<ErpApi.Features.Assembly.FactoryCategoryDetailService>();
builder.Services.AddScoped<ErpApi.Features.Materials.LabelOrders.IMaterialLabelOrderService, ErpApi.Features.Materials.LabelOrders.MaterialLabelOrderService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.LabelOrders.IPlasticLabelOrderService, ErpApi.Features.Plastics.LabelOrders.PlasticLabelOrderService>();
builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseSettings.PurchaseMaterialSettingsService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.MaterialSettings.PlasticMaterialSettingsService>();
builder.Services.AddScoped<ErpApi.Features.ImageNotes.ImageNoteService>();

// AI注塑啤机排产系统 集成:凭证走环境变量 Paiji__User/Paiji__Password(配置绑定),Basic 认证。
builder.Services.Configure<ErpApi.Integrations.Paiji.PaijiOptions>(builder.Configuration.GetSection("Paiji"));
builder.Services.AddHttpClient<ErpApi.Integrations.Paiji.PaijiPushService>((sp, c) =>
{
    var o = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ErpApi.Integrations.Paiji.PaijiOptions>>().Value;
    // BaseUrl 空/非法时不设 BaseAddress(服务侧 已配置=false 会拦住所有推送),避免此处抛 UriFormatException 拖垮注入方
    if (o.BaseUrl合法)
        c.BaseAddress = new Uri(o.BaseUrl.TrimEnd('/') + "/");
    // 默认 100s 太长:外部假死时审核接口最坏挂 N×100s
    c.Timeout = TimeSpan.FromSeconds(15);
    if (!string.IsNullOrWhiteSpace(o.User))
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{o.User}:{o.Password}")));
});
// 排产入库行→ERP塑胶入仓单 共享同步服务(轮询 PaijiSyncWorker 与 webhook PaijiWebhookController 共用)
builder.Services.AddScoped<ErpApi.Integrations.Paiji.PaijiReceiptSyncService>();
// 排产入库单→ERP塑胶入仓单 反向同步器(未配置凭证时内部直接退出)
builder.Services.AddHostedService<ErpApi.Integrations.Paiji.PaijiSyncWorker>();

// 喷油部排期系统(sprayplan-test):应用层账号走 SprayPlan__User/SprayPlan__Password;
// nginx Basic 凭据复用排产 Paiji 节(同一台 nginx)。
builder.Services.Configure<ErpApi.Integrations.SprayPlan.SprayPlanOptions>(builder.Configuration.GetSection("SprayPlan"));
builder.Services.AddHttpClient<ErpApi.Integrations.SprayPlan.SprayPlanPushService>((sp, c) =>
{
    var o = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ErpApi.Integrations.SprayPlan.SprayPlanOptions>>().Value;
    var basic = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<ErpApi.Integrations.Paiji.PaijiOptions>>().Value;
    // BaseUrl 空/非法时不设 BaseAddress(服务侧 已配置=false 会拦住所有推送),避免此处抛 UriFormatException 拖垮注入方
    if (o.BaseUrl合法)
        c.BaseAddress = new Uri(o.BaseUrl.TrimEnd('/') + "/");
    // 默认 100s 太长:外部假死时审核接口最坏挂 N×100s
    c.Timeout = TimeSpan.FromSeconds(15);
    if (!string.IsNullOrWhiteSpace(basic.User))
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{basic.User}:{basic.Password}")));
});
// 喷油排期入库申请单→ERP塑胶入仓单 同步服务与反向同步器(未配置凭证时内部直接退出)
builder.Services.AddScoped<ErpApi.Integrations.SprayPlan.SprayPlanReceiptSyncService>();
builder.Services.AddHostedService<ErpApi.Integrations.SprayPlan.SprayPlanSyncWorker>();

// JWT 认证（密钥来自环境变量，无硬编码）
var jwtKey = Environment.GetEnvironmentVariable(JwtTokenService.KeyEnvVar)
    ?? throw new InvalidOperationException($"请设置环境变量 {JwtTokenService.KeyEnvVar}");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Erp:Jwt:Issuer"],
            ValidAudience = builder.Configuration["Erp:Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
    });
builder.Services.AddAuthorization();

// 新系统(web2)开发走 vite 代理、生产由后端同源托管 wwwroot,无需跨域放行
var app = builder.Build();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapFallbackToFile("index.html");
app.Run();

public partial class Program { } // 供集成测试引用
