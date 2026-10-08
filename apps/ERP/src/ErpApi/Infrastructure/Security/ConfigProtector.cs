using System.Security.Cryptography;
using System.Text;
namespace ErpApi.Infrastructure.Security;

// 系统配置加密器：AES-GCM。密钥 = SHA256(ERP_CONFIG_KEY ?? ERP_JWT_KEY)。存 base64(nonce(12)+tag(16)+cipher)。
public sealed class ConfigProtector : IConfigProtector
{
    private readonly byte[] _key;
    private const int NonceLen = 12, TagLen = 16;

    public ConfigProtector()
    {
        var raw = Environment.GetEnvironmentVariable("ERP_CONFIG_KEY")
                  ?? Environment.GetEnvironmentVariable("ERP_JWT_KEY") ?? "";
        _key = SHA256.HashData(Encoding.UTF8.GetBytes(raw)); // 32 bytes
    }

    public string Encrypt(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain ?? "");
        var nonce = RandomNumberGenerator.GetBytes(NonceLen);
        var cipher = new byte[data.Length];
        var tag = new byte[TagLen];
        using var aes = new AesGcm(_key, TagLen);
        aes.Encrypt(nonce, data, cipher, tag);
        var outBuf = new byte[NonceLen + TagLen + cipher.Length];
        Buffer.BlockCopy(nonce, 0, outBuf, 0, NonceLen);
        Buffer.BlockCopy(tag, 0, outBuf, NonceLen, TagLen);
        Buffer.BlockCopy(cipher, 0, outBuf, NonceLen + TagLen, cipher.Length);
        return Convert.ToBase64String(outBuf);
    }

    public string? TryDecrypt(string stored)
    {
        try
        {
            var buf = Convert.FromBase64String(stored ?? "");
            if (buf.Length < NonceLen + TagLen) return null;
            var nonce = buf[..NonceLen];
            var tag = buf[NonceLen..(NonceLen + TagLen)];
            var cipher = buf[(NonceLen + TagLen)..];
            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(_key, TagLen);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch { return null; }
    }
}
