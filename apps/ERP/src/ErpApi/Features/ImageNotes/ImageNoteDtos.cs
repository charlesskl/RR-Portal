namespace ErpApi.Features.ImageNotes;

// 图片备注元数据行(对应 [图片备注] 表);文件本体在 wwwroot/uploads/<模块>/ 下
public sealed class ImageNoteDto
{
    public long ID { get; set; }
    public string 模块 { get; set; } = "";
    public string 单号 { get; set; } = "";
    public string? 文件名 { get; set; }
    public string? 存储路径 { get; set; }
    public string? 备注 { get; set; }
    public string? 上传人 { get; set; }
    public DateTime? 上传时间 { get; set; }
}
