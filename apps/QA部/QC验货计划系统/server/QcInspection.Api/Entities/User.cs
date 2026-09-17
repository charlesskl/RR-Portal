namespace QcInspection.Api.Entities;

public sealed class User
{
    public long Id { get; set; }
    public required string Username { get; set; }
    public required string DisplayName { get; set; }
    public required string PasswordHash { get; set; }
    public string Department { get; set; } = string.Empty;
    public string Role { get; set; } = "Viewer";
    public string DataScope { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
