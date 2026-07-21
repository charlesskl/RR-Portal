using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests;

/// <summary>
/// PdfStorage 单元测试：落盘暂存 + 防路径穿越。
/// TDD：先跑红（PdfStorage 尚不存在），实现后跑绿。
/// </summary>
public class PdfStorageTests : IDisposable
{
    private readonly string _tempDir;
    private readonly PdfStorage _storage;

    public PdfStorageTests()
    {
        // 每次测试用独立临时目录，避免测试间干扰
        _tempDir = Path.Combine(Path.GetTempPath(), "sp_pdf_" + Guid.NewGuid().ToString("N"));
        _storage = new PdfStorage(_tempDir);
    }

    public void Dispose()
    {
        // 测试结束清理临时目录
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    /// <summary>
    /// 往返测试：保存 → 存在 → 能读回相同内容长度
    /// </summary>
    [Fact]
    public async Task SaveAsync_RoundTrip_TokenExistsAndContentLengthMatches()
    {
        // Arrange
        var data = new byte[] { 1, 2, 3 };
        using var input = new MemoryStream(data);

        // Act
        var token = await _storage.SaveAsync(input);

        // Assert: token 不为空，且 Exists 为 true
        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.True(_storage.Exists(token));

        // Assert: Open 返回的流长度等于原始数据长度
        using var readBack = _storage.Open(token);
        Assert.Equal(data.Length, readBack.Length);
    }

    /// <summary>
    /// 防路径穿越：token 含 ../.. 不应命中目录外文件
    /// </summary>
    [Fact]
    public void Exists_WithPathTraversalToken_ReturnsFalse()
    {
        // Arrange：构造路径穿越 token
        var traversalToken = "../../evil";

        // Act & Assert：SafeName(GetFileName) 之后只在 _tempDir 内查找，不存在 → false
        Assert.False(_storage.Exists(traversalToken));
    }

    /// <summary>
    /// 构造函数会自动创建目录（不要求调用方预先建目录）
    /// </summary>
    [Fact]
    public void Constructor_CreatesDirectoryIfNotExists()
    {
        var newDir = Path.Combine(Path.GetTempPath(), "sp_pdf_new_" + Guid.NewGuid().ToString("N"));
        try
        {
            Assert.False(Directory.Exists(newDir));
            var _ = new PdfStorage(newDir);
            Assert.True(Directory.Exists(newDir));
        }
        finally
        {
            if (Directory.Exists(newDir))
                Directory.Delete(newDir, recursive: true);
        }
    }
}
