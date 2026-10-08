using Dapper;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.ImageNotes;

// 图片备注存取(表 [图片备注]);DI 注册见 Program.cs
public sealed class ImageNoteService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<ImageNoteDto>> ListAsync(string 模块, string 单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<ImageNoteDto>(@"
SELECT [ID],[模块],[单号],[文件名],[存储路径],[备注],[上传人],[上传时间]
FROM [图片备注] WHERE [模块]=@模块 AND [单号]=@单号 ORDER BY [ID]", new { 模块, 单号 });
        return rows.AsList();
    }

    public async Task<ImageNoteDto?> GetAsync(long id)
    {
        using var c = factory.Create();
        return await c.QuerySingleOrDefaultAsync<ImageNoteDto>(@"
SELECT [ID],[模块],[单号],[文件名],[存储路径],[备注],[上传人],[上传时间]
FROM [图片备注] WHERE [ID]=@id", new { id });
    }

    public async Task<ImageNoteDto> AddAsync(ImageNoteDto dto)
    {
        using var c = factory.Create();
        dto.ID = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [图片备注] ([模块],[单号],[文件名],[存储路径],[备注],[上传人],[上传时间])
OUTPUT INSERTED.[ID]
VALUES (@模块,@单号,@文件名,@存储路径,@备注,@上传人,@上传时间)", dto);
        return dto;
    }

    // 返回被删记录的存储路径(供调用方删文件);记录不存在返回 null
    public async Task<string?> DeleteAsync(long id)
    {
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<string?>(
            "DELETE FROM [图片备注] OUTPUT DELETED.[存储路径] WHERE [ID]=@id", new { id });
    }
}
