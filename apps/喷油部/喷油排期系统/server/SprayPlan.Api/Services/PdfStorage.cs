namespace SprayPlan.Api.Services;

/// <summary>
/// 上传 PDF 暂存服务：将 PDF 流落盘到配置目录，返回 token（=文件名）。
/// 待补产品订单按 token 关联原件，后续可通过 Open(token) 取回文件流。
/// </summary>
public class PdfStorage
{
    private readonly string _dir;

    public PdfStorage(string dir)
    {
        _dir = dir;
        // 目录不存在则自动创建（含多级父目录）
        Directory.CreateDirectory(_dir);
    }

    /// <summary>
    /// 将 PDF 流保存到暂存目录，返回 token（格式：32位hex + .pdf）。
    /// </summary>
    public async Task<string> SaveAsync(Stream pdf)
    {
        var token = Guid.NewGuid().ToString("N") + ".pdf";
        using var fs = File.Create(Path.Combine(_dir, token));
        await pdf.CopyToAsync(fs);
        return token;
    }

    /// <summary>
    /// 检查 token 对应的 PDF 文件是否存在于暂存目录。
    /// 使用 SafeName 防止路径穿越攻击。
    /// </summary>
    public bool Exists(string token) =>
        File.Exists(Path.Combine(_dir, SafeName(token)));

    /// <summary>
    /// 打开 token 对应的 PDF 文件流（只读）。
    /// 使用 SafeName 防止路径穿越攻击。
    /// </summary>
    public Stream Open(string token) =>
        File.OpenRead(Path.Combine(_dir, SafeName(token)));

    /// <summary>
    /// 安全取文件名：仅取最后一段文件名，去除路径分隔符，防止 ../../evil 等路径穿越。
    /// </summary>
    private static string SafeName(string token) => Path.GetFileName(token);
}
