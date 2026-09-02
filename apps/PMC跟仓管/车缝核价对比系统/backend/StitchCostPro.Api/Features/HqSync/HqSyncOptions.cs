namespace StitchCostPro.Api.Features.HqSync;

/// <summary>总部集成同步配置（配置节 HqSync，环境变量形如 HqSync__BaseUrl）。</summary>
public class HqSyncOptions
{
    public const string SectionName = "HqSync";

    public string BaseUrl { get; set; } = "";          // 总部只读 API 根地址，如 https://hq.example.com
    public string ApiKey { get; set; } = "";           // Bearer 密钥（总部发放）
    public bool Enabled { get; set; } = false;         // 是否启用定时同步（默认关，手动触发不受此限制）
    public int SyncIntervalMinutes { get; set; } = 15; // 定时同步周期（分钟）
    public int PageSize { get; set; } = 100;           // 单页条数（总部上限 200）
    public int DefaultDeptId { get; set; }             // 总部没有部门概念：>0 时同步数据挂到该部门；0=自动取 HQ/第一个部门
}
