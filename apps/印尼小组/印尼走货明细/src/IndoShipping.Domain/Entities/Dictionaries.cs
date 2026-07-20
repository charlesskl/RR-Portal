namespace IndoShipping.Domain.Entities;

public class DictHs
{
    public int Id { get; set; }
    public string Keyword { get; set; } = "";
    public string? HsCn { get; set; }
    public string? HsId { get; set; }
    public int Priority { get; set; } = 100;
}

public class DictSupplier
{
    public int Id { get; set; }
    public string Keyword { get; set; } = "";
    public string? FullName { get; set; }
    public string? CustomsCompany { get; set; }
    public int Priority { get; set; } = 100;
}
