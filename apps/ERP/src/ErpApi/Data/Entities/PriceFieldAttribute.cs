namespace ErpApi.Data.Entities;

/// <summary>
/// 标记"价格/成本"字段。无"单价"权限的用户读取主数据时，控制器会把这些字段置空，
/// 在后端落实成本保密（不仅前端隐藏）。仅可用于可空数值属性。
/// </summary>
[AttributeUsage(AttributeTargets.Property, Inherited = false)]
public sealed class PriceFieldAttribute : Attribute;
