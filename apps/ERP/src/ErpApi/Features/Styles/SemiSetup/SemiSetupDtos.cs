using System.Text.Json.Serialization;
namespace ErpApi.Features.Styles.SemiSetup;

// 半成品设置一行明细（从 BOM 行带过来做参照）。
public sealed record SemiSetupLineDto(
    string 物料编号, string? 物料名称, string? 规格,
    string? 颜色, string? 单位, decimal? 使用数量);

// 保存载荷：货号 + 半成品名称 + 类型(半成品) + 用量(做 1 个成品要几个该半成品) + 勾选出的物料组合。
public sealed record SemiSetupSaveDto(
    string 货号, string 名称, string 类型, decimal? 用量, List<SemiSetupLineDto> 明细);

// 设置视图：头部 + 明细。
public sealed record SemiSetupView(
    [property: JsonPropertyName("ID")] long ID,   // 全大写 ID,camelCase 会拼成 id,钉死原名(前端用 d.ID)
    string 货号, string 名称, string 类型, int 顺序, decimal 用量,
    string? 操作员, DateTime 创建时间, List<SemiSetupLineDto> 明细);
