using System.Text.Json.Serialization;
using ErpApi.Data.Entities;
namespace ErpApi.Features.Styles;

public sealed record StyleColorDto(string? 颜色编号, string? 颜色名称);

public sealed record AssemblyMaterialExtensionDto(
    string? 产品装配名称, string? 配件编号, string? 共用物料编号,
    string? 装配方式, string? 类别, decimal? 库存单价HK, decimal? 其他成本HK,
    decimal? 需求用量, string? 单位, bool 半成品计算库存, string? 备注内容,
    bool 调整审核, string? 审核人, DateTime? 审核时间);

public sealed record AssemblyMaterialQuoteDto(
    long? ID, string? 物料编号, string? 物料名称, string 合作方类型,
    string? 合作方编号, string? 合作方名称, DateTime? 报价日期, string? 货币,
    decimal? 单价, decimal? 港币价, decimal? 对比相差, decimal? 相差比例,
    bool 是否默认, int 顺序, string? 备注);

// BOM物料设置一行（用量=使用数量，材料=物料类别）。
public sealed record StyleMaterialDto(
    string? 物料编号, string? 物料名称, string? 物料类别,
    string? 规格, string? 颜色, string? 单位, decimal? 使用数量,
    string? 工模编号 = null, string? 备注 = null);

// BOM 反审核申请（申请-审批流：操作员申请 → 经理消息中心批准 → 一步到位回未审核）
public sealed class BomReverseAuditRequestDto
{
    public string? 原因 { get; set; }
}

// BOM物料设置保存载荷：单头（客户/日期/单位，逐行落库）+ 明细行。默认单价/类型 落 款号物料总表。
// 款式：新款号保存 BOM 时自动建档到 款号总表；老货号提交非空款式则同步更新 款号总表.款式
// (BOM 页产品名称可编辑,保存即改名;传空则不动,避免抹掉已有名称)。
// MA货号：实单版 BOM 关联的模板 MA 货号（MA 版传 null），持久化到 款号物料总表.MA货号。
public sealed record BomSaveDto(
    string? 客户编号, string? 客户名称, DateTime? 日期, string? 单位,
    List<StyleMaterialDto> 明细,
    AssemblyMaterialExtensionDto? 扩展 = null,
    List<AssemblyMaterialQuoteDto>? 报价 = null,
    string? 默认单价 = null, string? 类型 = null, string? 款式 = null,
    [property: JsonPropertyName("MA货号")] string? MA货号 = null,   // 大写 MA 开头,camelCase 策略会错拼成 mA货号,钉死原名(同 PO号 先例)
    string? 待绑定PO号 = null);   // 从排期跳转建 BOM 时带入,BOM 审核成功后自动绑定到 款号物料PO绑定 并清空(首字符非 ASCII,camelCase 策略不会动)

// BOM 已绑定的 PO 号(合同号)一条记录
public sealed record BomPoBindingDto(
    [property: JsonPropertyName("PO号")] string PO号,   // 同上:钉死序列化名,避免 pO号
    DateTime 绑定时间);

// 显式绑定 PO 号请求体
public sealed class BomPoBindRequestDto
{
    [JsonPropertyName("PO号")]
    public string? PO号 { get; set; }
}

// BOM 复制单载荷：目标款号 + 是否覆盖目标已有 BOM。
public sealed record StyleBomCopyDto(string 目标款号, bool 覆盖 = false);

// BOM 调入下级半成品的可选款号（已在 半成品共用物料设置 中设置的半成品/成品）。
public sealed record SemiOptionDto(string 款号, string? 款式, string? 类别, decimal? 需求用量, string? 单位);

// BOM 单头视图(款号物料总表 台头行;此前应用层从不写该表,现由保存链路 upsert)
// MA货号：实单版 BOM 关联的模板 MA 货号（MA 版为 null）
// PO号：有效 PO(待绑定PO号 优先;审核绑定清空后回落 款号物料PO绑定 最近一条),装配物料设置据此区分同货号不同实单
public sealed record BomHeaderViewDto(
    DateTime? 日期, string? 客户编号, string? 客户名称, string? 单位,
    string? 默认单价, string? 类型, string? 操作员, string? 审核, string? 备注,
    [property: JsonPropertyName("MA货号")] string? MA货号 = null,   // 同上:钉死序列化名
    string? 反审核申请 = null, string? 反审核申请人 = null, string? 反审核申请原因 = null,
    [property: JsonPropertyName("PO号")] string? PO号 = null);   // 同上:钉死序列化名,避免 pO号

// BOM物料设置轻量载入：款式、物料行、装配扩展和报价(+台头)。
public sealed record StyleMaterialsViewDto(
    string 款号, string? 款式, IReadOnlyList<款号物料明细表> 物料,
    AssemblyMaterialExtensionDto? 扩展,
    IReadOnlyList<AssemblyMaterialQuoteDto>? 报价,
    BomHeaderViewDto? 单头 = null);

// 装配BOM 领料展开一行(来料领料单「按装配BOM带入」):仓库=来料/塑胶(物料资料 优先,塑胶物料资料 次之)
public sealed record AssemblyIssueLineDto(
    string 物料编号, string? 物料名称, string? 规格, string? 颜色, string? 单位,
    decimal 数量, string 仓库);

// 装配BOM 领料展开结果:行=展开后的组成物料(同物料合并);跳过半成品=材料列=半成品但无定义、无法展开的 BOM 行
public sealed record AssemblyIssueViewDto(
    IReadOnlyList<AssemblyIssueLineDto> 行,
    IReadOnlyList<string> 跳过半成品);

public sealed record StyleFullDto(
    款号总表 主档,
    IReadOnlyList<StyleColorDto> 颜色,
    IReadOnlyList<string> 尺码,
    IReadOnlyList<款号明细表> 工序,
    IReadOnlyList<款号物料明细表> 物料);

// 生产通知单 货号选择:已做 BOM 物料设置的款号及单头信息(选中带出到单据)
public sealed record BomHeaderOptionDto(
    string? 款号, string? 款式, string? 客户编号, string? 客户名称,
    string? 单位, string? 默认单价, string? 类型,
    // 从排期跳转建 BOM 带入的待绑定 PO(BOM 未审核时绑定还没落 款号物料PO绑定,生产单页据此预填合同号)
    string? 待绑定PO号 = null);
