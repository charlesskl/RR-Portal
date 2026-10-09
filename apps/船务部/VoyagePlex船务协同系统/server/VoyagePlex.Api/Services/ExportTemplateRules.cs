using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class ExportTemplateRules
{
    public static bool CanManage(string role) => role is "admin" or "supervisor";
    public static string? Validate(ExportTemplate value)
    {
        if (string.IsNullOrWhiteSpace(value.Name) || value.Name.Length > 100) return "模板名称须为 1 至 100 个字符";
        if (value.ShipmentMode is not ("Container" or "Warehouse")) return "请选择走柜或交仓";
        if (value.Purpose is not ("Shipping" or "Warehouse")) return "请选择船务或仓务用途";
        if (string.IsNullOrWhiteSpace(value.Version) || value.Version.Length > 30) return "版本须为 1 至 30 个字符";
        if (value.Notes.Length > 2000) return "说明不能超过 2000 个字符";
        if (value.IsDefault && !value.IsEnabled) return "停用模板不能设为默认";
        return null;
    }
}
