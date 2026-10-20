using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class ExportTemplateRules
{
    public static bool CanManage(string role) => role is "admin" or "supervisor" or "shipping";
    public static string? Validate(ExportTemplate value)
    {
        if (string.IsNullOrWhiteSpace(value.Name) || value.Name.Length > 100) return "模板名称须为 1 至 100 个字符";
        if (value.ShipmentMode is not ("Container" or "Warehouse")) return "请选择走柜或交仓";
        if (value.Purpose is not ("Shipping" or "Warehouse")) return "请选择船务或仓务用途";
        if (string.IsNullOrWhiteSpace(value.Version) || value.Version.Length > 30) return "版本须为 1 至 30 个字符";
        if (value.Notes.Length > 2000) return "说明不能超过 2000 个字符";
        if (value.WeightRule is not ("Template" or "Truncate" or "Exact" or "DisplayInteger")) return "请选择有效的模板毛重公式";
        if (value.LayoutKey is not ("Standard" or "SkyCastle" or "CustomerItem" or "CartonMarks")) return "请选择有效的表格版式";
        if (value.Company != "Huadeng" && (value.WeightRule == "DisplayInteger" || value.LayoutKey is "CustomerItem" or "CartonMarks")) return "该公式或客户特殊版式仅适用于华登";
        if (value.LayoutKey == "CartonMarks" && value.ShipmentMode != "Warehouse") return "箱唛尺寸特殊表仅适用于交仓任务";
        if (value.LayoutKey == "SkyCastle" && value.ShipmentMode != "Container") return "多柜特殊表仅适用于做柜任务";
        if (value.Company == "Huadeng" && !((value.LayoutKey == "Standard" && value.WeightRule == "DisplayInteger") || (value.LayoutKey == "SkyCastle" && value.WeightRule == "Template"))) return "华登仅使用普通走柜、普通交仓及SKY分柜特殊表";
        if (value.Company == "Huadeng" && !value.IsEnabled) return "华登三种固定模板不能停用";
        if (value.IsDefault && !value.IsEnabled) return "停用模板不能设为默认";
        return null;
    }
}
