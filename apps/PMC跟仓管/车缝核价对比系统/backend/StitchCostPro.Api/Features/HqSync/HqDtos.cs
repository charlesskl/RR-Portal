using System.Text.Json.Serialization;

namespace StitchCostPro.Api.Features.HqSync;

/// <summary>总部列表返回外壳。游标 next_updated_after / next_cursor_id 原样保存、原样回传，不做解析。</summary>
public record HqListPage<T>
{
    [JsonPropertyName("data")] public List<T> Data { get; set; } = [];
    [JsonPropertyName("next_updated_after")] public string? NextUpdatedAfter { get; set; }
    [JsonPropertyName("next_cursor_id")] public string? NextCursorId { get; set; }
    [JsonPropertyName("has_more")] public bool HasMore { get; set; }
}

/// <summary>总部加工厂记录（/api/integration/v1/factories）。</summary>
public record HqFactoryDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("craft")] public string? Craft { get; set; }
    [JsonPropertyName("contact_person")] public string? ContactPerson { get; set; }
    [JsonPropertyName("contact_phone")] public string? ContactPhone { get; set; }
    [JsonPropertyName("address")] public string? Address { get; set; }
    [JsonPropertyName("equipment_qty")] public int? EquipmentQty { get; set; }
    [JsonPropertyName("staff_count")] public int? StaffCount { get; set; }
    [JsonPropertyName("monthly_capacity")] public decimal? MonthlyCapacity { get; set; }
    [JsonPropertyName("cert_status")] public string? CertStatus { get; set; }
    [JsonPropertyName("region")] public string? Region { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }   // active / inactive
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
    [JsonPropertyName("is_deleted")] public bool IsDeleted { get; set; }
    [JsonPropertyName("deleted_at")] public string? DeletedAt { get; set; }
}

/// <summary>总部订单记录（/api/integration/v1/orders）。一条记录 = 本地一条采购订单明细行，id 为幂等键。</summary>
public record HqOrderDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("order_no")] public string OrderNo { get; set; } = null!;
    [JsonPropertyName("factory_id")] public string? FactoryId { get; set; }
    [JsonPropertyName("item_no")] public string? ItemNo { get; set; }
    [JsonPropertyName("product")] public string? Product { get; set; }
    [JsonPropertyName("quantity")] public decimal? Quantity { get; set; }
    [JsonPropertyName("unit")] public string? Unit { get; set; }
    [JsonPropertyName("process")] public string? Process { get; set; }
    [JsonPropertyName("process_category")] public string? ProcessCategory { get; set; }
    [JsonPropertyName("quote_labor_price")] public decimal? QuoteLaborPrice { get; set; }   // 核价工价(不含税)
    [JsonPropertyName("supplier_price")] public decimal? SupplierPrice { get; set; }        // 历史参考字段，第一阶段不映射
    [JsonPropertyName("unit_price")] public decimal? UnitPrice { get; set; }                // 外发工价(不含税)
    [JsonPropertyName("unit_price_cny_tax")] public decimal? UnitPriceCnyTax { get; set; }  // 外发工价(含税)
    [JsonPropertyName("tax_point")] public decimal? TaxPoint { get; set; }
    [JsonPropertyName("price_effective_at")] public string? PriceEffectiveAt { get; set; }
    [JsonPropertyName("order_date")] public string? OrderDate { get; set; }
    [JsonPropertyName("delivery_date")] public string? DeliveryDate { get; set; }
    [JsonPropertyName("actual_delivery_date")] public string? ActualDeliveryDate { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }   // placed/producing/delivered/cancelled/returned/voided
    [JsonPropertyName("progress")] public int Progress { get; set; }
    [JsonPropertyName("delay_days")] public int DelayDays { get; set; }
    [JsonPropertyName("delay_reason")] public string? DelayReason { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
    [JsonPropertyName("is_deleted")] public bool IsDeleted { get; set; }
    [JsonPropertyName("deleted_at")] public string? DeletedAt { get; set; }
}
