using System.Text.Json;

internal static class ProofUtilities
{
    internal static string FingerprintJson(long count, object? value)
    {
        if (count < 0) throw new MigrationRejected("invalid_fingerprint_count");
        if (value is null or DBNull)
        {
            if (count != 0) throw new MigrationRejected("nonempty_fingerprint_returned_null");
            return "[]";
        }
        if (value is not string json) throw new MigrationRejected("fingerprint_json_type_differs");
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Array || document.RootElement.GetArrayLength() != count)
            throw new MigrationRejected("fingerprint_row_count_differs");
        return json;
    }
}
