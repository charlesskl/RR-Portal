using System.Text.Json;

namespace IndoShipping.Bootstrap;

public sealed class SeedSnapshot
{
    private readonly IReadOnlyDictionary<string, IReadOnlyList<JsonElement>> _tables;
    private readonly IReadOnlyDictionary<string, JsonElement> _imageMetadata;

    private SeedSnapshot(
        string schemaVersion,
        IReadOnlyDictionary<string, IReadOnlyList<JsonElement>> tables,
        IReadOnlyList<JsonElement> images,
        IReadOnlyList<JsonElement> users)
    {
        SchemaVersion = schemaVersion;
        _tables = tables;
        Images = images;
        Users = users;
        ExpectedCounts = tables.ToDictionary(pair => pair.Key, pair => pair.Value.Count, StringComparer.OrdinalIgnoreCase);
        _imageMetadata = Rows("images").ToDictionary(
            row => row.GetProperty("id").GetString() ?? throw new InvalidDataException("Image metadata has no id."),
            StringComparer.Ordinal);
    }

    public string SchemaVersion { get; }
    public IReadOnlyList<JsonElement> Images { get; }
    public IReadOnlyList<JsonElement> Users { get; }
    public IReadOnlyDictionary<string, int> ExpectedCounts { get; }

    public static SeedSnapshot Load(string path)
    {
        using var stream = File.OpenRead(path);
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        var tablesElement = root.GetProperty("tables");
        var tables = new Dictionary<string, IReadOnlyList<JsonElement>>(StringComparer.OrdinalIgnoreCase);

        foreach (var table in tablesElement.EnumerateObject())
            tables[table.Name] = table.Value.EnumerateArray().Select(row => row.Clone()).ToArray();

        var images = root.GetProperty("images").EnumerateArray().Select(image => image.Clone()).ToArray();
        var users = new List<JsonElement>();
        foreach (var page in root.GetProperty("users").EnumerateArray())
        {
            if (page.TryGetProperty("items", out var items))
                users.AddRange(items.EnumerateArray().Select(user => user.Clone()));
        }

        var snapshot = new SeedSnapshot(root.GetProperty("schemaVersion").GetString() ?? "", tables, images, users);
        if (snapshot.Count("images") != snapshot.Images.Count)
            throw new InvalidDataException("Image metadata and payload counts do not match.");

        return snapshot;
    }

    public int Count(string table) => Rows(table).Count;

    public IReadOnlyList<JsonElement> Rows(string table) =>
        _tables.TryGetValue(table, out var rows) ? rows : Array.Empty<JsonElement>();

    public bool TryGetImageMetadata(string id, out JsonElement metadata) =>
        _imageMetadata.TryGetValue(id, out metadata);
}
