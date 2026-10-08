using ErpApi.Engines.DocumentNumber;
using Xunit;

public class DocumentNumberFormatTests
{
    [Fact]
    public void Formats_prefix_date_seq_padded()
    {
        var s = DocumentNumberGenerator.Format("CRK", new DateTime(2026, 6, 3), 7);
        Assert.Equal("CRK20260603007", s); // 前缀 + yyyyMMdd + 流水补零3位
    }

    [Fact]
    public void Seq_over_999_keeps_full_digits()
    {
        var s = DocumentNumberGenerator.Format("CRK", new DateTime(2026, 6, 3), 1234);
        Assert.Equal("CRK202606031234", s);
    }
}
