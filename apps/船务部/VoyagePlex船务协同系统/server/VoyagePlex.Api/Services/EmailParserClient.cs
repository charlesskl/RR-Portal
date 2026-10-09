using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.DataProtection;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public sealed class EmailParserClient(HttpClient httpClient, VoyagePlex.Api.Data.AppDbContext db, IDataProtectionProvider protection)
{
    public async Task<ParserResponse> PollMailboxAsync(long afterUid, string startDate, CancellationToken cancellationToken, string company = "Xingxin", AppUser? owner = null)
    {
        using var response = owner is null
            ? await httpClient.GetAsync($"/v1/mailbox/poll?after_uid={afterUid}&start_date={Uri.EscapeDataString(startDate)}&company={company}", cancellationToken)
            : await httpClient.PostAsJsonAsync("/v1/mailbox/poll", new { after_uid = afterUid, start_date = startDate, company,
                address = owner.MailboxAddress, auth_code = protection.CreateProtector("PersonalMailbox.v1").Unprotect(owner.MailboxSecretProtected), host = owner.MailboxHost, folder = owner.MailboxFolder }, cancellationToken);
        return new ParserResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/json",
            await response.Content.ReadAsStringAsync(cancellationToken));
    }
    public async Task<ParserResponse> TestMailboxAsync(string address, string secret, string host, string folder, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        using var response = await httpClient.PostAsJsonAsync("/v1/mailbox/test", new { address, auth_code = secret, host, folder }, timeout.Token);
        return new ParserResponse((int)response.StatusCode, "application/json", await response.Content.ReadAsStringAsync(timeout.Token));
    }

    public async Task<ParserResponse> ParseBatchAsync(
        IReadOnlyList<IFormFile> files,
        CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent();
        foreach (var file in files)
        {
            var stream = file.OpenReadStream();
            var content = new StreamContent(stream);
            content.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType ?? "message/rfc822");
            form.Add(content, "files", file.FileName);
        }

        using var response = await httpClient.PostAsync("/v1/email-batches/parse", form, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/json";
        return new ParserResponse((int)response.StatusCode, contentType, body);
    }

    public async Task<ParserResponse> ParseInspectionMappingAsync(
        IFormFile file, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent();
        var content = new StreamContent(file.OpenReadStream());
        content.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType ?? "application/octet-stream");
        form.Add(content, "file", file.FileName);
        using var response = await httpClient.PostAsync("/v1/inspection-mappings/parse", form, cancellationToken);
        return new ParserResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/json",
            await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<ParserResponse> ParseProductWorkbooksAsync(
        IReadOnlyList<IFormFile> files, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent();
        foreach (var file in files)
        {
            var content = new StreamContent(file.OpenReadStream());
            content.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            form.Add(content, "files", file.FileName);
        }
        using var response = await httpClient.PostAsync("/v1/product-workbooks/parse", form, cancellationToken);
        return new ParserResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/json",
            await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<ParserResponse> ScanLocalInventoryAsync(CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync($"/v1/local-inventory-scan?company={db.Company}", cancellationToken);
        return new ParserResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/json",
            await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<ParserResponse> MatchLocalInventoryAsync(object payload, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync($"/v1/local-inventory-match?company={db.Company}", payload, cancellationToken);
        return new ParserResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/json",
            await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<ParserResponse> ParseFactoryMappingAsync(IFormFile file, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent();
        using var content = new StreamContent(file.OpenReadStream());
        form.Add(content, "file", file.FileName);
        using var response = await httpClient.PostAsync("/v1/factory-mappings/parse", form, cancellationToken);
        return new ParserResponse((int)response.StatusCode, response.Content.Headers.ContentType?.ToString() ?? "application/json", await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<ShipmentExportResponse> ExportShipmentAsync(
        object shipment, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync("/v1/shipment-export", shipment, cancellationToken);
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        var fileName = response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"')
            ?? "走柜表.xlsx";
        return new ShipmentExportResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream", fileName, bytes);
    }

    public async Task<ShipmentExportResponse> ExportInventoryAdjustmentAsync(
        object shipment, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync("/v1/inventory-adjustment-export", shipment, cancellationToken);
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        var fileName = response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"')
            ?? "库存扣减写回表.xlsx";
        return new ShipmentExportResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream", fileName, bytes);
    }

    public async Task<ShipmentExportResponse> ExportCompletedShipmentSummaryAsync(
        object payload, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync("/v1/completed-shipment-summary-export", payload, cancellationToken);
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        var fileName = response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"') ?? "走柜任务汇总.xlsx";
        return new ShipmentExportResponse((int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream", fileName, bytes);
    }
}

public sealed record ParserResponse(int StatusCode, string ContentType, string Body);
public sealed record ShipmentExportResponse(int StatusCode, string ContentType, string FileName, byte[] Body);
