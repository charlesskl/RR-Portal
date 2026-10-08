namespace ErpApi.Engines.Posting;
public interface IPostingEngine
{
    Task<bool> ApproveAsync(string table, string docNo, string user);     // 审核 0->1
    Task<bool> UnapproveAsync(string table, string docNo, string user);   // 反审核 1->0
}
