using System.Linq;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

public class ProductImportApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    // 造一个含两层表 sheet 的工作簿（用内联字符串）
    static byte[] BuildSheet(string sheetName, string?[][] rows)
    {
        using var ms = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(ms, SpreadsheetDocumentType.Workbook))
        {
            var wbPart = doc.AddWorkbookPart();
            wbPart.Workbook = new Workbook();
            var wsPart = wbPart.AddNewPart<WorksheetPart>();
            var data = new SheetData();
            for (int r = 0; r < rows.Length; r++)
            {
                var row = new Row { RowIndex = (uint)(r + 1) };
                for (int c = 0; c < rows[r].Length; c++)
                {
                    var col = (char)('A' + c);
                    var cell = new Cell { CellReference = $"{col}{r + 1}", DataType = CellValues.InlineString };
                    cell.Append(new InlineString(new Text(rows[r][c] ?? "")));
                    row.Append(cell);
                }
                data.Append(row);
            }
            wsPart.Worksheet = new Worksheet(data);
            var sheets = wbPart.Workbook.AppendChild(new Sheets());
            sheets.Append(new Sheet { Id = wbPart.GetIdOfPart(wsPart), SheetId = 1, Name = sheetName });
            wbPart.Workbook.Save();
        }
        return ms.ToArray();
    }

    static MultipartFormDataContent FileContent(byte[] bytes, string name = "file.xlsx")
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        content.Add(file, "file", name);
        return content;
    }

    [Fact]
    public async Task Preview_RecognizesTwoLevel_And_FlagsPendingCraft()
    {
        var bytes = BuildSheet("47101", new string?[][] {
            new[]{"货号","货名","工序","目标数","人数","工价","核价","油漆价","报价"},
            new[]{"47101","联合收割机右身","喷油","2600","2","0.138","0.291","0.174","0.4"},
            new[]{"","联合收割机车底","摆货","9000","1","0.02","0.042","0.025","0.08"},
        });
        var resp = await _client.PostAsync("/api/products/import/preview", FileContent(bytes));
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, json.GetProperty("normalCount").GetInt32());
        Assert.Equal(1, json.GetProperty("pendingCraftCount").GetInt32());
        var prod = json.GetProperty("products")[0];
        Assert.Equal("47101", prod.GetProperty("productNo").GetString());
        Assert.Equal("联合收割机", prod.GetProperty("suggestedItemName").GetString());
        var parts = prod.GetProperty("parts");
        Assert.Equal("手喷", parts[0].GetProperty("category").GetString());
        Assert.True(parts[1].GetProperty("category").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task Preview_UsesCraftAlias_Over_Heuristic()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SprayPlan.Api.Data.AppDbContext>();
            db.CraftAliases.Add(new SprayPlan.Api.Entities.CraftAlias { Alias = "摆货", Category = "自动喷", CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }
        var bytes = BuildSheet("X", new string?[][] {
            new[]{"货号","货名","工序","核价"},
            new[]{"X1","身","摆货","0.1"},
        });
        var resp = await _client.PostAsync("/api/products/import/preview", FileContent(bytes));
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, json.GetProperty("pendingCraftCount").GetInt32());
        Assert.Equal("自动喷", json.GetProperty("products")[0].GetProperty("parts")[0].GetProperty("category").GetString());
    }

    [Fact]
    public async Task Preview_FlagsDuplicate_And_Unrecognized()
    {
        await _client.PostAsJsonAsync("/api/products", new { productNo = "DUP", customerName = "X",
            items = new[]{ new { itemName="主体", parts = new[]{ new { partName="头", craft="移印", unitCost=1.0 } } } } });

        using var ms = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(ms, SpreadsheetDocumentType.Workbook))
        {
            var wbPart = doc.AddWorkbookPart(); wbPart.Workbook = new Workbook();
            void AddSheet(string nm, string?[][] rows, uint id)
            {
                var wsPart = wbPart.AddNewPart<WorksheetPart>();
                var data = new SheetData();
                for (int r = 0; r < rows.Length; r++) { var row = new Row { RowIndex=(uint)(r+1) };
                    for (int c=0;c<rows[r].Length;c++){ var cell=new Cell{CellReference=$"{(char)('A'+c)}{r+1}",DataType=CellValues.InlineString}; cell.Append(new InlineString(new Text(rows[r][c]??""))); row.Append(cell);} data.Append(row); }
                wsPart.Worksheet = new Worksheet(data);
                (wbPart.Workbook.GetFirstChild<Sheets>() ?? wbPart.Workbook.AppendChild(new Sheets()))
                    .Append(new Sheet { Id = wbPart.GetIdOfPart(wsPart), SheetId = id, Name = nm });
            }
            AddSheet("DUP", new string?[][]{ new[]{"货号","货名","工序","核价"}, new[]{"DUP","头","移印","1"} }, 1);
            AddSheet("BAD", new string?[][]{ new[]{"产品编号","配件名称","实际核价"}, new[]{"91039","眼睛","0.1"} }, 2);
            wbPart.Workbook.Save();
        }
        var resp = await _client.PostAsync("/api/products/import/preview", FileContent(ms.ToArray()));
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, json.GetProperty("duplicateCount").GetInt32());
        Assert.True(json.GetProperty("products")[0].GetProperty("duplicate").GetBoolean());
        Assert.Single(json.GetProperty("unrecognized").EnumerateArray());
    }

    [Fact]
    public async Task Commit_CreatesDraftProducts_UpsertsAlias_SkipsDuplicate()
    {
        await _client.PostAsJsonAsync("/api/products", new { productNo = "DUP", customerName = "X",
            items = new[]{ new { itemName="主体", parts = new[]{ new { partName="头", craft="移印", unitCost=1.0 } } } } });

        var req = new
        {
            customerName = "兴信",
            products = new object[]
            {
                new { productNo = "NEW1", specName = "标准", importAsNewVersion = false, parts = new object[]
                {
                    new { itemName="联合收割机", partName="右身", craft="手喷", craftDetail="喷油",
                          dailyCapacity=2600, stdMachineCount=2, laborPrice=0.138, unitCost=0.291, paintCost=0.174, quotedPrice=0.4, remark=(string?)null },
                }},
                new { productNo = "DUP", specName = "标准", importAsNewVersion = false, parts = new object[]
                {
                    new { itemName="主体", partName="头", craft="移印", craftDetail="",
                          dailyCapacity=0, stdMachineCount=1, laborPrice=0.0, unitCost=1.0, paintCost=0.0, quotedPrice=0.0, remark=(string?)null },
                }},
            }
        };
        var resp = await _client.PostAsJsonAsync("/api/products/import/commit", req);
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, json.GetProperty("created").GetInt32());
        Assert.Equal(1, json.GetProperty("skipped").GetInt32());

        var list = await _client.GetFromJsonAsync<JsonElement>("/api/products");
        var ne = list.EnumerateArray().First(p => p.GetProperty("productNo").GetString() == "NEW1");
        Assert.Equal("draft", ne.GetProperty("status").GetString());
        var pid = ne.GetProperty("id").GetInt32();
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{pid}");
        var part0 = detail.GetProperty("items")[0].GetProperty("parts")[0];
        Assert.Equal("喷油", part0.GetProperty("craftDetail").GetString());
        Assert.Equal("手喷", part0.GetProperty("craft").GetString());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SprayPlan.Api.Data.AppDbContext>();
        var alias = await db.CraftAliases.SingleOrDefaultAsync(a => a.Alias == "喷油");
        Assert.NotNull(alias);
        Assert.Equal("手喷", alias!.Category);
    }

    [Fact]
    public async Task Commit_ThreeLevel_GroupsByItem()
    {
        var req = new
        {
            customerName = (string?)null,
            products = new object[]
            {
                new { productNo = "TL1", specName = "标准", importAsNewVersion = false, parts = new object[]
                {
                    new { itemName="3#包包", partName="大身", craft="移印", craftDetail="移印", dailyCapacity=1, stdMachineCount=1, laborPrice=0.0, unitCost=0.1, paintCost=0.0, quotedPrice=0.0, remark=(string?)null },
                    new { itemName="3#包包", partName="拉链", craft="移印", craftDetail="移印", dailyCapacity=1, stdMachineCount=1, laborPrice=0.0, unitCost=0.1, paintCost=0.0, quotedPrice=0.0, remark=(string?)null },
                    new { itemName="3#鞋子", partName="左鞋", craft="移印", craftDetail="移印", dailyCapacity=1, stdMachineCount=1, laborPrice=0.0, unitCost=0.1, paintCost=0.0, quotedPrice=0.0, remark=(string?)null },
                }},
            }
        };
        (await _client.PostAsJsonAsync("/api/products/import/commit", req)).EnsureSuccessStatusCode();
        var list = await _client.GetFromJsonAsync<JsonElement>("/api/products");
        var p = list.EnumerateArray().First(x => x.GetProperty("productNo").GetString() == "TL1");
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{p.GetProperty("id").GetInt32()}");
        var items = detail.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());
        Assert.Equal(2, items[0].GetProperty("parts").GetArrayLength());
        Assert.Equal(1, items[1].GetProperty("parts").GetArrayLength()); // 3#鞋子 只有 左鞋 一个部位
    }

    // I-1 回归测试：同一请求内两个相同 productNo+specName（importAsNewVersion=false），
    // 应 created=1 skipped=1，不应 500（之前会撞 SQLite 唯一索引崩溃）
    [Fact]
    public async Task Commit_SameBatchDuplicateKey_SkipsSecond_Returns200()
    {
        var req = new
        {
            customerName = (string?)null,
            products = new object[]
            {
                new { productNo = "BATCH_DUP", specName = "标准", importAsNewVersion = false, parts = new object[]
                {
                    new { itemName="主体", partName="头", craft="手喷", craftDetail="喷油",
                          dailyCapacity=1000, stdMachineCount=1, laborPrice=0.1, unitCost=0.2, paintCost=0.05, quotedPrice=0.3, remark=(string?)null },
                }},
                // 同批次第二条：相同 productNo + specName，未入库，DB 查重查不到，必须靠 batchKeys 拦截
                new { productNo = "BATCH_DUP", specName = "标准", importAsNewVersion = false, parts = new object[]
                {
                    new { itemName="主体", partName="身", craft="手喷", craftDetail="喷油",
                          dailyCapacity=800, stdMachineCount=1, laborPrice=0.08, unitCost=0.18, paintCost=0.04, quotedPrice=0.25, remark=(string?)null },
                }},
            }
        };
        var resp = await _client.PostAsJsonAsync("/api/products/import/commit", req);
        // 必须 200，不能 500（唯一索引冲突）
        Assert.Equal(System.Net.HttpStatusCode.OK, resp.StatusCode);
        var json = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(1, json.GetProperty("created").GetInt32());
        Assert.Equal(1, json.GetProperty("skipped").GetInt32());
    }

    // 重新导入已存在货号 → 跳过（一个货号一条产品，已无规格版本概念）
    [Fact]
    public async Task Commit_ExistingProductNo_Skips()
    {
        await _client.PostAsJsonAsync("/api/products", new { productNo = "VER1",
            items = new[]{ new { itemName="主体", parts = new[]{ new { partName="头", craft="移印", unitCost=1.0 } } } } });

        var req = new
        {
            products = new object[]
            {
                new { productNo = "VER1", parts = new object[]
                {
                    new { itemName="主体", partName="头", craft="移印", craftDetail="移印",
                          dailyCapacity=1, stdMachineCount=1, laborPrice=0.0, unitCost=2.0, paintCost=0.0, quotedPrice=0.0, remark=(string?)null },
                }},
            }
        };
        var resp = await _client.PostAsJsonAsync("/api/products/import/commit", req);
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, json.GetProperty("created").GetInt32());
        Assert.Equal(1, json.GetProperty("skipped").GetInt32());

        var list = await _client.GetFromJsonAsync<JsonElement>("/api/products");
        var ver1 = list.EnumerateArray().Where(p => p.GetProperty("productNo").GetString() == "VER1").ToList();
        Assert.Single(ver1);
    }
}
