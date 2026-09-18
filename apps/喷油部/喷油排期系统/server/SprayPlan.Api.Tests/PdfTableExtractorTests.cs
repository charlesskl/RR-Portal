using System.Text.Json;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests;

// PdfTableExtractor 几何还原测试 —— 用真实 PDF 抽出的"带坐标词"fixture 驱动。
// fixture 路径：bin 输出目录下的 Fixtures/（由 .csproj 拷贝）。
public class PdfTableExtractorTests
{
    [Fact]
    public void OcrImageSample_WhenProvided_RecognizesTwoProductQuantities()
    {
        var path = Environment.GetEnvironmentVariable("SPRAYPLAN_SAMPLE_IMAGE");
        if (string.IsNullOrWhiteSpace(path)) return;
        using var source = File.OpenRead(path);
        var words = OrderImageOcr.Extract(source, Path.GetExtension(path));
        var parsed = OcrOrderParser.Extract(words);
        Assert.Equal("CMC2600139", parsed.Head.ExternalOrderNo);
        Assert.Equal(new DateTime(2026, 9, 18), parsed.Head.OrderDate);
        Assert.Equal(new DateTime(2026, 9, 28), parsed.Head.DeliveryDate);
        Assert.Collection(parsed.Rows,
            first => { Assert.Equal("15792", first.ProductNo); Assert.Equal(417, first.Qty); },
            second => { Assert.Equal("15783", second.ProductNo); Assert.Equal(21000, second.Qty); });
    }
    [Fact]
    public void ExtractProductRows_HuadengTwoProductsRemainSeparate()
    {
        static PdfWord W(string text, double x, double y, double width = 35) =>
            new(1, text, x, x + width, y - 10, y);
        var words = new List<PdfWord>
        {
            W("款号", 49, 628, 20), W("物料名称", 122, 628, 40), W("用料名称", 199, 628, 40),
            W("颜色", 256, 628, 20), W("单重G", 289, 628, 25), W("总重KG", 321, 628, 30),
            W("数量", 366, 628, 20), W("单价", 412, 628, 20), W("金额(HK$)", 456, 628, 45), W("备注", 530, 628, 20),
            W("15792总MA", 30, 606, 55), W("W-06-04/20MM尾扣", 100, 606, 85),
            W("(印喷件)", 120, 600, 40), W("417", 365, 606, 28),
            W("15783总MA", 30, 575, 55), W("E-11-04/35MM眼扣", 100, 575, 85),
            W("(印喷件)", 120, 569, 40), W("21,000", 365, 575, 30), W("HK$0.14", 405, 575, 35),
            W("TOTAL：", 410, 500),
        };
        var rows = PdfTableExtractor.ExtractProductRows(words);
        Assert.Collection(rows,
            first => { Assert.Equal("15792", first.ProductNo); Assert.Equal(417, first.Qty); Assert.True(first.IsMa); },
            second => { Assert.Equal("15783", second.ProductNo); Assert.Equal(21000, second.Qty); Assert.Equal(0.14, second.UnitPrice, 6); });
    }
    // 读取 fixture JSON → List<PdfWord>
    private static IReadOnlyList<PdfWord> LoadWords(string fileName)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", fileName);
        var json = File.ReadAllText(path);
        var words = JsonSerializer.Deserialize<List<PdfWord>>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        Assert.NotNull(words);
        Assert.NotEmpty(words!);
        return words!;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 15787：简单单，1 行物料
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Extract15787_Rows_单行物料数量正确()
    {
        var words = LoadWords("words_15787.json");
        var rows = PdfTableExtractor.ExtractRows(words);

        Assert.Single(rows);
        Assert.Equal("E-11-06/35mm眼扣(印喷件)", rows[0].ItemRaw);
        Assert.Equal(20000, rows[0].Qty);
    }

    [Fact]
    public void Extract15787_ProductNoCell_含款号且MA为真()
    {
        var words = LoadWords("words_15787.json");
        var cell = PdfTableExtractor.ExtractProductNoCell(words);

        Assert.Contains("15787", cell);
        var pm = PdfImportParse.ParseProductNoAndMa(cell);
        Assert.Equal("15787", pm.ProductNo);
        Assert.True(pm.IsMa);
    }

    [Fact]
    public void Extract15787_Head_抬头字段正确()
    {
        var words = LoadWords("words_15787.json");
        var head = PdfTableExtractor.ExtractHead(words);

        Assert.Equal("ZWYP2026060", head.ExternalOrderNo);
        Assert.Equal(new DateTime(2026, 5, 19), head.OrderDate);
        Assert.Equal(new DateTime(2026, 6, 3), head.DeliveryDate);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11494 第1页：套装大单，5 行动物子件
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Extract11494_Rows_五行动物子件数量正确()
    {
        var words = LoadWords("words_11494_p1.json");
        var rows = PdfTableExtractor.ExtractRows(words);

        Assert.Equal(5, rows.Count);

        var expectedAnimals = new[] { "兔子", "青蛙", "蝾螈", "熊", "猫" };
        for (int i = 0; i < expectedAnimals.Length; i++)
        {
            Assert.Contains(expectedAnimals[i], rows[i].ItemRaw);
            Assert.Contains("(印喷件)", rows[i].ItemRaw);
            Assert.Equal(3949, rows[i].Qty);
        }
    }

    [Fact]
    public void Extract11494_ProductNoCell_含款号且MA为假()
    {
        var words = LoadWords("words_11494_p1.json");
        var cell = PdfTableExtractor.ExtractProductNoCell(words);

        Assert.Contains("11494", cell);
        var pm = PdfImportParse.ParseProductNoAndMa(cell);
        Assert.Equal("11494", pm.ProductNo);
        Assert.False(pm.IsMa);
    }

    [Fact]
    public void Extract11494_Head_抬头字段正确()
    {
        var words = LoadWords("words_11494_p1.json");
        var head = PdfTableExtractor.ExtractHead(words);

        Assert.Equal("ZWZ2026057", head.ExternalOrderNo);
        Assert.Equal(new DateTime(2026, 5, 20), head.OrderDate);
        Assert.Equal(new DateTime(2026, 6, 9), head.DeliveryDate);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11494 完整 33 页：多页续表回归。真机暴露的两个 bug——
    //   ① 表头"物料名称"窜进每页第一行子件名；② 同一视觉行词序颠倒"(印喷件)动物"。
    // fixture 由真实 PDF 导出，坐标含亚像素抖动，单页理想 fixture 测不出。
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Extract11494Full_无表头窜入且后缀在末尾()
    {
        var words = LoadWords("words_11494_full.json");
        var rows = PdfTableExtractor.ExtractRows(words);

        Assert.NotEmpty(rows);

        foreach (var r in rows)
        {
            // bug①：任何子件名都不应含表头词"物料名称"
            Assert.DoesNotContain("物料名称", r.ItemRaw);

            // bug②：含"印喷件"后缀的行，后缀必须在末尾——
            //   即不能以"(印喷件)"/"（印喷件）"开头，且去掉末尾后缀后剩余不再含"印喷件"。
            Assert.False(r.ItemRaw.StartsWith("(印喷件)") || r.ItemRaw.StartsWith("（印喷件）"),
                $"后缀跑到了开头：<{r.ItemRaw}>");
            if (r.ItemRaw.Contains("印喷件"))
            {
                var stripped = PdfImportParse.NormalizeItemName(r.ItemRaw);
                Assert.DoesNotContain("印喷件", stripped);
                Assert.NotEqual("", stripped); // 去后缀后必须还有动物名
            }
        }

        // 锁定首行正确形态（第1页第1行 = 兔子(印喷件)）
        Assert.Equal("兔子(印喷件)", rows[0].ItemRaw);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PdfWordSource：真实 PDF 端到端冒烟。真实 PDF 不入仓库，缺文件时跳过(不变红)。
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void PdfWordSource_真实PDF抽词冒烟()
    {
        // 真实 PDF 在业务方桌面临时目录，不可入仓库。缺文件即跳过。
        var pdfPath = Path.Combine(
            "C:", "Users", "DELL", "Desktop", "AI搭建文件临时存放",
            "喷油排期系统", "15787.pdf");

        if (!File.Exists(pdfPath))
            // xUnit 2.x 无 Assert.Skip，缺文件只能 return 提前退出。
            // 注意：此分支会被计为 Passed 而非 Skipped，CI 上看不出真实 E2E 没跑。
            return;

        using var fs = File.OpenRead(pdfPath);
        var words = PdfWordSource.Extract(fs);

        Assert.NotEmpty(words);
        // 抽出的词应能驱动 ExtractRows 产出至少一行。
        var rows = PdfTableExtractor.ExtractRows(words);
        Assert.NotEmpty(rows);
    }
}
