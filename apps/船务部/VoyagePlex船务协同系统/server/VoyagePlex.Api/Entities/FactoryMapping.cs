namespace VoyagePlex.Api.Entities;

public sealed class FactoryMapping
{
    public long Id { get; set; }
    public string EnglishName { get; set; } = "";
    public string ChineseShortName { get; set; } = "";
    public bool IsLocal { get; set; }
}
