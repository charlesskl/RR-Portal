namespace ErpApi.Infrastructure.Security;
public interface IConfigProtector
{
    string Encrypt(string plain);
    string? TryDecrypt(string stored);
}
