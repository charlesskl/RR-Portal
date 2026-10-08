using System.Security.Claims;
using System.Text;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Warehouse.Semi.ShortageAnalysis;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Tests;

public sealed class SemiFinishedShortageControllerTests
{
    [Fact]
    public async Task List_forbids_without_open_permission()
    {
        var controller = Controller(open: false, print: false, out _);

        Assert.IsType<ForbidResult>(await controller.List(new()));
    }

    [Fact]
    public async Task List_returns_service_result_with_open_permission()
    {
        var controller = Controller(open: true, print: false, out var service);
        service.ListResult = new([Row()], 1, 1, 50);

        var ok = Assert.IsType<OkObjectResult>(await controller.List(new()));

        Assert.Same(service.ListResult, ok.Value);
    }

    [Fact]
    public async Task Export_forbids_without_print_permission()
    {
        var controller = Controller(open: true, print: false, out _);

        Assert.IsType<ForbidResult>(await controller.Export(new()));
    }

    [Fact]
    public async Task Export_returns_csv_with_print_permission_without_open_permission()
    {
        var controller = Controller(open: false, print: true, out _);

        Assert.IsType<FileContentResult>(await controller.Export(new()));
    }

    [Fact]
    public async Task Export_returns_bom_csv_in_page_column_order_and_escapes_cells()
    {
        var controller = Controller(open: true, print: true, out var service);
        service.ExportRows = [new SemiFinishedShortageRow
        {
            Customer = "客户,甲",
            ProductCode = "SFS-P1",
            ProductName = "产品\"甲\"",
            PartCode = "SFS-A1",
            AssemblyName = "装配\r\n甲",
            Unit = "PCS",
            RequiredQuantity = 15m,
            InventoryQuantity = 6m,
            ShortageQuantity = 9m,
        }];

        var file = Assert.IsType<FileContentResult>(await controller.Export(new()));
        var text = Encoding.UTF8.GetString(file.FileContents);

        Assert.StartsWith("\uFEFF客户,产品货号,产品名称,配件编号,产品装配名称,单位,需求数量,库存数量,欠料数量\r\n", text);
        Assert.Contains("\"客户,甲\",SFS-P1,\"产品\"\"甲\"\"\",SFS-A1,\"装配\r\n甲\",PCS,15,6,9\r\n", text);
        Assert.Equal("text/csv; charset=utf-8", file.ContentType);
        Assert.Equal("半成品欠料分析表.csv", file.FileDownloadName);
    }

    [Fact]
    public async Task Export_neutralizes_spreadsheet_formula_prefixes_in_text_cells()
    {
        var controller = Controller(open: true, print: true, out var service);
        service.ExportRows = [new SemiFinishedShortageRow
        {
            Customer = "=HYPERLINK(\"https://example.test\")",
            ProductCode = "+SUM(1,1)",
            ProductName = "-2+3",
            PartCode = "@SUM(A1:A2)",
            AssemblyName = "safe",
            Unit = "PCS",
            RequiredQuantity = 1m,
            InventoryQuantity = 0m,
            ShortageQuantity = 1m,
        }];

        var file = Assert.IsType<FileContentResult>(await controller.Export(new()));
        var text = Encoding.UTF8.GetString(file.FileContents);

        Assert.Contains("'=HYPERLINK", text);
        Assert.Contains("'+SUM", text);
        Assert.Contains("'-2+3", text);
        Assert.Contains("'@SUM", text);
    }

    private static SemiFinishedShortageController Controller(
        bool open,
        bool print,
        out FakeShortageService service)
    {
        service = new FakeShortageService();
        var controller = new SemiFinishedShortageController(
            service,
            new FakePermissionService(open, print));
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "tester")],
                    "test")),
            },
        };
        return controller;
    }

    private static SemiFinishedShortageRow Row() => new()
    {
        Customer = "客户甲",
        ProductCode = "SFS-P1",
        ProductName = "产品甲",
        PartCode = "SFS-A1",
        AssemblyName = "装配甲",
        Unit = "PCS",
        RequiredQuantity = 15m,
        InventoryQuantity = 6m,
        ShortageQuantity = 9m,
    };

    private sealed class FakeShortageService : ISemiFinishedShortageService
    {
        public SemiFinishedShortageResult ListResult { get; set; } = new([], 0, 1, 50);
        public IReadOnlyList<SemiFinishedShortageRow> ExportRows { get; set; } = [];

        public Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query) =>
            Task.FromResult(ListResult);

        public Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query) =>
            Task.FromResult(ExportRows);
    }

    private sealed class FakePermissionService(bool open, bool print) : IPermissionService
    {
        public Task<bool> HasAsync(string userName, string menu, PermissionAction action) =>
            Task.FromResult(action switch
            {
                PermissionAction.打开 => open,
                PermissionAction.打印 => print,
                _ => false,
            });

        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName) =>
            Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(
                new Dictionary<string, PermissionFlags>());
    }
}
