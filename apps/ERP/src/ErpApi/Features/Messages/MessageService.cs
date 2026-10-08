using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Messages;

// 消息后台：领料单三级流转(主管→经理→仓管)等系统消息。接收人=账号(用户)。
public sealed class MessageService(ISqlConnectionFactory factory)
{
    public sealed class MessageRow
    {
        public long ID { get; set; }
        public string? 接收人 { get; set; }
        public string? 类型 { get; set; }
        public string? 单号 { get; set; }
        public string? 标题 { get; set; }
        public string? 内容 { get; set; }
        public string? 已读 { get; set; }
        public DateTime? 创建时间 { get; set; }
        public DateTime? 读取时间 { get; set; }
    }

    // 批量发消息（同一批接收人、同一内容）。接收人为空静默跳过。
    public async Task SendAsync(IEnumerable<string> 接收人列表, string 类型, string? 单号, string 标题, string? 内容)
    {
        var targets = 接收人列表.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Distinct().ToList();
        if (targets.Count == 0) return;
        using var c = factory.Create();
        foreach (var user in targets)
            await c.ExecuteAsync(@"
INSERT INTO [消息]([接收人],[类型],[单号],[标题],[内容])
VALUES(@user,@类型,@单号,@标题,@内容)", new { user, 类型, 单号, 标题, 内容 });
    }

    public async Task<PagedResult<MessageRow>> ListAsync(string user, bool onlyUnread, int page, int size)
    {
        if (page < 1) page = 1;
        size = Math.Clamp(size, 1, 100);
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [消息] WHERE [接收人]=@user AND (@unread=0 OR ISNULL([已读],'0')<>'1');
SELECT [ID],[接收人],[类型],[单号],[标题],[内容],[已读],[创建时间],[读取时间]
FROM [消息] WHERE [接收人]=@user AND (@unread=0 OR ISNULL([已读],'0')<>'1')
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { user, unread = onlyUnread ? 1 : 0, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MessageRow>()).AsList();
        return new PagedResult<MessageRow>(items, total);
    }

    public async Task<int> UnreadCountAsync(string user)
    {
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [消息] WHERE [接收人]=@user AND ISNULL([已读],'0')<>'1'", new { user });
    }

    // 只能读自己的消息；返回 false=消息不存在或不属于该用户
    public async Task<bool> MarkReadAsync(long id, string user)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(
            "UPDATE [消息] SET [已读]='1',[读取时间]=SYSDATETIME() WHERE [ID]=@id AND [接收人]=@user AND ISNULL([已读],'0')<>'1'",
            new { id, user });
        return n > 0;
    }
}
