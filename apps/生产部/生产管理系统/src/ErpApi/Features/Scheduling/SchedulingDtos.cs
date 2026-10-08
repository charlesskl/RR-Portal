using System.Text.Json.Serialization;
namespace ErpApi.Features.Scheduling;

// 排期明细列表行（Dapper 按列名映射；ASCII 开头的属性名显式指定 JSON 名，防止 camelCase 变成 pO号/sku）
public sealed class ScheduleRowDto
{
    [JsonPropertyName("ID")] public long ID { get; set; }
    public long? 批次ID { get; set; }   // NULL=手工新增行(不属于任何导入批次)
    public string? 排期客户 { get; set; }
    public string? 状态 { get; set; }
    public DateTime? 接单日期 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 国家 { get; set; }
    [JsonPropertyName("PO号")] public string? PO号 { get; set; }
    public string? 客PO { get; set; }
    [JsonPropertyName("SKU")] public string? SKU { get; set; }
    public string? 货号 { get; set; }
    public string? 品名 { get; set; }
    public decimal? 数量 { get; set; }
    public int? 内箱 { get; set; }
    public int? 外箱 { get; set; }
    public decimal? 总箱数 { get; set; }
    public DateTime? 走货期 { get; set; }
    public DateTime? 验货期 { get; set; }
    public string? 第三方验货 { get; set; }
    public string? 车间 { get; set; }
    public string? 来源工作表 { get; set; }
    public string? 备注 { get; set; }
    public string? 原始数据 { get; set; }
    public DateTime? 创建日期 { get; set; }
    public string? 操作员 { get; set; }
    // 该行有待经理审核的状态变更时=目标状态(列表状态列显「→X·待审」)
    public string? 待审新状态 { get; set; }
    // MA 规则:货号 -MA 结尾=MA单(全部物料下单做半成品),否则实单(半成品做成品)
    public string? 单类型 { get; set; }
    // 实单才有:按「系列前缀-MA」关联——数字开头的货号取前导数字串(92125A/92125H 等后缀只是区分国家,同属 92125 系列),
    // 字母开头取首段;同排期客户下存在该 MA 行时带出它的状态(无=null)
    public string? 关联MA货号 { get; set; }
    public string? 关联MA状态 { get; set; }
    // BOM 关联:BOM 业务键=货号(款号物料总表.款号=排期行.货号,一个 BOM 可供多个实单/MA单用);
    // BOM款号=null=未建 BOM;绑定PO数=该 BOM 已绑的 PO 个数;已绑本PO=是否绑了本排期行的 PO号
    [JsonPropertyName("BOM款号")] public string? BOM款号 { get; set; }  // 全大写 BOM,camelCase 会拼成 bom款号,钉死原名
    public int 绑定PO数 { get; set; }
    public bool 已绑本PO { get; set; }
}

// 状态变更申请行(生产排期状态变更 + 排期行的 货号/PO号/排期客户 展示字段)
public sealed class ScheduleStatusChangeDto
{
    [JsonPropertyName("ID")] public long ID { get; set; }
    public long 排期ID { get; set; }
    public string? 原状态 { get; set; }
    public string? 新状态 { get; set; }
    public string? 审核状态 { get; set; }
    public string? 申请人 { get; set; }
    public DateTime? 申请日期 { get; set; }
    public string? 审核人 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public string? 审核备注 { get; set; }
    public string? 排期客户 { get; set; }
    [JsonPropertyName("PO号")] public string? PO号 { get; set; }
    public string? 货号 { get; set; }
    public string? 品名 { get; set; }
}

// PUT 结果:行不存在=null;状态待审核=true 表示状态变更已挂起等经理审核(其余字段已生效)
public sealed record ScheduleUpdateResult(bool 状态待审核);

// 审核通过/驳回请求体(备注可空)
public sealed class StatusChangeReviewRequest
{
    public string? 审核备注 { get; set; }
}

// 导入批次列表行（行数由子查询带出）
public sealed class ScheduleBatchDto
{
    [JsonPropertyName("ID")] public long ID { get; set; }
    public string? 排期客户 { get; set; }
    public string? 文件名 { get; set; }
    public DateTime? 导入日期 { get; set; }
    public string? 操作员 { get; set; }
    public int 新增 { get; set; }
    public int 更新 { get; set; }
    public int 行数 { get; set; }
    public string? 备注 { get; set; }
}

// 排期表(文件)分类行:一个批次一张,带行数/货号数/状态分布
public sealed class ScheduleFileDto
{
    [JsonPropertyName("ID")] public long ID { get; set; }
    public string? 排期客户 { get; set; }
    public string? 文件名 { get; set; }
    public DateTime? 导入日期 { get; set; }
    public string? 操作员 { get; set; }
    public int 行数 { get; set; }
    public int 货号数 { get; set; }
    public int 在排 { get; set; }
    public int 已走货 { get; set; }
    public int 已取消 { get; set; }
}

// 汇总：按 排期客户 × 状态 统计行数与数量（页面顶部卡片）
public sealed class ScheduleSummaryDto
{
    public string? 排期客户 { get; set; }
    public string? 状态 { get; set; }
    public int 行数 { get; set; }
    public decimal? 数量 { get; set; }
}

// 导入结果：比通用 ImportResult 多一个"更新"（排期重复导入按自然键更新状态/日期）
public sealed class ScheduleImportResult
{
    public long 批次ID { get; set; }
    public int 新增 { get; set; }
    public int 更新 { get; set; }
    public int 跳过 { get; set; }
    public int 失败 { get; set; }
    public List<ErpApi.Features.MasterData.ImportFailure> 失败明细 { get; set; } = new();
}

// 手工新增/编辑排期行(POST/PUT /api/scheduling);批次ID/创建日期/操作员由服务端填
public sealed class ScheduleRowSaveRequest
{
    public string? 排期客户 { get; set; }
    public string? 状态 { get; set; }
    public DateTime? 接单日期 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 国家 { get; set; }
    [JsonPropertyName("PO号")] public string? PO号 { get; set; }
    public string? 客PO { get; set; }
    [JsonPropertyName("SKU")] public string? SKU { get; set; }
    public string? 货号 { get; set; }
    public string? 品名 { get; set; }
    public decimal? 数量 { get; set; }
    public int? 内箱 { get; set; }
    public int? 外箱 { get; set; }
    public decimal? 总箱数 { get; set; }
    public DateTime? 走货期 { get; set; }
    public DateTime? 验货期 { get; set; }
    public string? 第三方验货 { get; set; }
    public string? 车间 { get; set; }
    public string? 备注 { get; set; }
}
