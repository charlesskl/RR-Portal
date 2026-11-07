namespace ErpApi.Features.MasterData;

public static class RawMaterialUnits
{
    public const string Kilograms = "KG";

    public static string? CanonicalKgAlias(string? unit) => unit?.Trim() switch
    {
        "公斤" or "千克" => Kilograms,
        { } value when string.Equals(value, Kilograms, StringComparison.OrdinalIgnoreCase) => Kilograms,
        _ => unit
    };
}
