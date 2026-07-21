namespace SprayPlan.Api.Entities;

// 工序对照表 craft_aliases：把核价表里的工序「小类」（喷油/散枪/PP水…）映射到系统 4 大类（手喷/移印/自动喷/UV）。
// 导入时按此表把小类翻成大类；预览里人工指定的小类会 upsert 进来，下次自动识别。
public class CraftAlias
{
    public int Id { get; set; }
    public string Alias { get; set; } = "";    // 小类名（唯一）
    public string Category { get; set; } = ""; // 大类：手喷/移印/自动喷/UV
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}
