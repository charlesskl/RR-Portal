using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Features.ImageNotes;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;
using Xunit;

[Collection("db")]
public sealed class ImageNoteControllerTests(DbFixture fx)
{
    private sealed class TestPermissionService : IPermissionService
    {
        private readonly HashSet<PermissionAction> allowed = [];
        public static TestPermissionService Allow(params PermissionAction[] actions)
        {
            var s = new TestPermissionService();
            s.allowed.UnionWith(actions);
            return s;
        }
        public Task<bool> HasAsync(string userName, string menu, PermissionAction action)
            => Task.FromResult(allowed.Contains(action));
        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName)
            => Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(new Dictionary<string, PermissionFlags>());
    }

    private sealed class TempWebHostEnv(string webRoot) : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "tests";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = webRoot;
        public string EnvironmentName { get; set; } = "Test";
        public string WebRootPath { get; set; } = webRoot;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class ThrowingConnectionFactory : ISqlConnectionFactory
    {
        public string GetConnectionString() => throw new Xunit.Sdk.XunitException("该用例不应触达数据库。");
        public SqlConnection Create() => throw new Xunit.Sdk.XunitException("该用例不应触达数据库。");
    }

    private sealed class FixtureConnectionFactory(string cs) : ISqlConnectionFactory
    {
        public string GetConnectionString() => cs;
        public SqlConnection Create() => new(cs);
    }

    private static ImageNoteController Controller(
        IPermissionService perms, ISqlConnectionFactory factory, string webRoot)
    {
        var c = new ImageNoteController(new ImageNoteService(factory), perms, new TempWebHostEnv(webRoot));
        c.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "img-tester")], "test"))
            }
        };
        return c;
    }

    private static FormFile PngFile(long bytes = 16)
    {
        var ms = new MemoryStream(new byte[bytes]);
        return new FormFile(ms, 0, ms.Length, "file", "pic.png")
        { Headers = new HeaderDictionary(), ContentType = "image/png" };
    }

    [Fact]
    public async Task List_requires_open_permission()
    {
        var result = await Controller(new TestPermissionService(), new ThrowingConnectionFactory(), Path.GetTempPath())
            .List("BOM", "S-1");
        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task List_rejects_unknown_module_before_permission_check()
    {
        var result = await Controller(TestPermissionService.Allow(PermissionAction.打开), new ThrowingConnectionFactory(), Path.GetTempPath())
            .List("未知", "S-1");
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Upload_rejects_disallowed_extension()
    {
        var file = new FormFile(new MemoryStream([1, 2, 3]), 0, 3, "file", "evil.exe");
        var result = await Controller(TestPermissionService.Allow(PermissionAction.保存), new ThrowingConnectionFactory(), Path.GetTempPath())
            .Upload("BOM", "S-1", null, file);
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Upload_rejects_oversize_file()
    {
        var result = await Controller(TestPermissionService.Allow(PermissionAction.保存), new ThrowingConnectionFactory(), Path.GetTempPath())
            .Upload("BOM", "S-1", null, PngFile(10L * 1024 * 1024 + 1));
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Upload_requires_save_permission()
    {
        var result = await Controller(new TestPermissionService(), new ThrowingConnectionFactory(), Path.GetTempPath())
            .Upload("生产单", "MO-1", null, PngFile());
        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Upload_rejects_missing_file()
    {
        var result = await Controller(TestPermissionService.Allow(PermissionAction.保存), new ThrowingConnectionFactory(), Path.GetTempPath())
            .Upload("BOM", "S-1", null, null);
        Assert.IsType<BadRequestObjectResult>(result);
    }

    // —— 以下需 ERP_TEST_DB + 临时上传目录,验证 上传/列表/删除 全链路(含文件落盘与清理) ——

    private static SqlConnection OpenSchemaOrSkip(DbFixture fx)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB，跳过图片备注集成测试");
        var c = fx.Open();
        var ok = c.ExecuteScalar<int>(
            "SELECT CASE WHEN OBJECT_ID(N'[图片备注]', N'U') IS NOT NULL THEN 1 ELSE 0 END") == 1;
        if (!ok)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 缺少 [图片备注] 表(先执行 db/55_image_notes.sql)");
        }
        return c;
    }

    [SkippableFact]
    public async Task Upload_list_delete_roundtrip_with_temp_storage()
    {
        using var c = OpenSchemaOrSkip(fx);
        var webRoot = Path.Combine(Path.GetTempPath(), $"img-notes-{Guid.NewGuid():N}");
        var 单号 = $"IMG-TEST-{Guid.NewGuid():N}"[..30];
        var factory = new FixtureConnectionFactory(fx.ConnectionString!);
        var controller = Controller(TestPermissionService.Allow(PermissionAction.打开, PermissionAction.保存), factory, webRoot);
        try
        {
            var upload = Assert.IsType<OkObjectResult>(
                await controller.Upload("BOM", 单号, "测试备注", PngFile(128)));
            var note = Assert.IsType<ImageNoteDto>(upload.Value);
            Assert.True(note.ID > 0);
            Assert.Equal("BOM", note.模块);
            Assert.Equal("测试备注", note.备注);
            Assert.Equal("img-tester", note.上传人);
            var filePath = Path.Combine(webRoot, note.存储路径!.Replace('/', Path.DirectorySeparatorChar));
            Assert.True(File.Exists(filePath));

            var list = Assert.IsType<OkObjectResult>(await controller.List("BOM", 单号));
            var rows = Assert.IsAssignableFrom<IReadOnlyList<ImageNoteDto>>(list.Value);
            Assert.Single(rows);
            Assert.Equal(note.ID, rows[0].ID);

            Assert.IsType<NoContentResult>(await controller.Delete(note.ID));
            Assert.False(File.Exists(filePath));
            Assert.Empty(await new ImageNoteService(factory).ListAsync("BOM", 单号));
        }
        finally
        {
            c.Execute("DELETE FROM [图片备注] WHERE [单号]=@单号", new { 单号 });
            if (Directory.Exists(webRoot)) Directory.Delete(webRoot, recursive: true);
        }
    }

    [SkippableFact]
    public async Task Delete_unknown_id_returns_not_found()
    {
        using var c = OpenSchemaOrSkip(fx);
        var webRoot = Path.Combine(Path.GetTempPath(), $"img-notes-{Guid.NewGuid():N}");
        var controller = Controller(TestPermissionService.Allow(PermissionAction.保存),
            new FixtureConnectionFactory(fx.ConnectionString!), webRoot);
        Assert.IsType<NotFoundResult>(await controller.Delete(-1));
    }
}
