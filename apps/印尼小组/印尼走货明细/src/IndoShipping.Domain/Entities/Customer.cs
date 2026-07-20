namespace IndoShipping.Domain.Entities;

public class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public bool Active { get; set; } = true;
}

public class SettingEntry
{
    public string Key { get; set; } = "";
    public string? Value { get; set; }
    public DateTime UpdatedAt { get; set; }
}
