using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ErpApi.Integrations.Paiji;
using Microsoft.Extensions.Options;
namespace ErpApi.Integrations.SprayPlan;

// 喷油部排期系统(sprayplan-test)HTTP 客户端。
// 两层认证:① nginx Basic 在 Program.cs AddHttpClient 配置(凭据复用排产 Paiji 节);
//           ② 应用层 JWT:POST auth/login 后取 Set-Cookie 的 sprayplan_session,后续请求显式带 Cookie 头,401 时重登一次。
// 未配置凭证或 BaseUrl 空/非法时 已配置=false,调用方应整体跳过,保证未配置环境不受影响。
public sealed class SprayPlanPushService(
    HttpClient http, IOptions<SprayPlanOptions> options, IOptions<PaijiOptions> paiji, ILogger<SprayPlanPushService> logger)
{
    private readonly SprayPlanOptions _opt = options.Value;
    private string? _cookie;

    public bool 已配置 => !string.IsNullOrWhiteSpace(_opt.User) && !string.IsNullOrWhiteSpace(_opt.Password)
        && !string.IsNullOrWhiteSpace(paiji.Value.User) && !string.IsNullOrWhiteSpace(paiji.Value.Password)
        && _opt.BaseUrl合法;

    private async Task<string> EnsureLoginAsync()
    {
        if (_cookie is not null) return _cookie;
        using var resp = await http.PostAsJsonAsync("auth/login", new { username = _opt.User, password = _opt.Password });
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) throw new InvalidOperationException($"sprayplan 登录失败({(int)resp.StatusCode}): {body}");
        var setCookie = resp.Headers.TryGetValues("Set-Cookie", out var vals)
            ? vals.FirstOrDefault(v => v.StartsWith("sprayplan_session=", StringComparison.Ordinal)) : null;
        _cookie = setCookie?.Split(';')[0]
            ?? throw new InvalidOperationException("sprayplan 登录响应缺少 sprayplan_session Cookie");
        return _cookie;
    }

    // 带 Cookie 发请求;401 时清缓存重登一次再试
    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, object? body, bool retry = true)
    {
        var cookie = await EnsureLoginAsync();
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Add("Cookie", cookie);
        if (body is not null) req.Content = JsonContent.Create(body);
        var resp = await http.SendAsync(req);
        if (resp.StatusCode == HttpStatusCode.Unauthorized && retry)
        {
            resp.Dispose();
            _cookie = null;
            return await SendAsync(method, url, body, false);
        }
        return resp;
    }

    private Task<HttpResponseMessage> GetAsync(string url) => SendAsync(HttpMethod.Get, url, null);
    private Task<HttpResponseMessage> PostAsync(string url, object body) => SendAsync(HttpMethod.Post, url, body);
    private Task<HttpResponseMessage> DeleteAsync(string url) => SendAsync(HttpMethod.Delete, url, null);

    // 按 ProductNo 找产品 id;找不到则创建(带部位);货号重复 409 时重新查列表兜底
    private async Task<int?> EnsureProductAsync(SprayPlanOrderDraft draft)
    {
        var existing = await FindProductIdAsync(draft.ProductNo);
        if (existing is not null) return existing;
        using (var resp = await PostAsync("products", draft.Product))
        {
            var body = await resp.Content.ReadAsStringAsync();
            if (resp.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var id)) return id;
            }
            else if (resp.StatusCode != HttpStatusCode.Conflict)
            {
                logger.LogWarning("sprayplan 建产品失败 {ProductNo} {Status}: {Body}", draft.ProductNo, resp.StatusCode, body);
                return null;
            }
        }
        return await FindProductIdAsync(draft.ProductNo);   // 409 或响应无 id → 再查一次
    }

    private async Task<int?> FindProductIdAsync(string productNo)
    {
        using var resp = await GetAsync("products");
        if (!resp.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        foreach (var p in doc.RootElement.EnumerateArray())
            if (p.TryGetProperty("productNo", out var no) && no.GetString() == productNo
                && p.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var id))
                return id;
        return null;
    }

    // 逐组推送:一款号一张订单,收集远端订单 id;单组失败记 失败 不中断。
    public async Task<(List<long> Ids, List<string> 失败)> PushOrdersAsync(IReadOnlyList<SprayPlanOrderDraft> drafts)
    {
        var ids = new List<long>();
        var 失败 = new List<string>();
        foreach (var draft in drafts)
        {
            try
            {
                var productId = await EnsureProductAsync(draft);
                if (productId is null) { 失败.Add($"{draft.ProductNo}(产品创建/查找失败)"); continue; }
                draft.Order.ProductId = productId;
                using var resp = await PostAsync("orders", draft.Order);
                var body = await resp.Content.ReadAsStringAsync();
                if (resp.StatusCode == HttpStatusCode.Conflict)
                {
                    var existing = await FindOrderAsync(draft.Order.ExternalOrderNo!);
                    if (existing is { } e && e.Status == "archived")
                    {
                        // 软删(archived)仍占号:换号新建(基础号-R2、-R3… 取第一个空闲号),
                        // 推到对方的是全新 draft 单等人工接单;回收站残留旧 archived 单不用管
                        var 新号 = SprayPlanMapper.空闲重推号(draft.Order.ExternalOrderNo!, await AllExternalOrderNosAsync());
                        logger.LogInformation("sprayplan 单号 {Old} 已归档占用,换号重推为 {New}", draft.Order.ExternalOrderNo, 新号);
                        draft.Order.ExternalOrderNo = 新号;
                        using var retry = await PostAsync("orders", draft.Order);
                        var rbody = await retry.Content.ReadAsStringAsync();
                        if (retry.IsSuccessStatusCode)
                        {
                            var rid = ParseId(rbody) ?? (await FindOrderAsync(新号))?.Id;
                            if (rid is null) 失败.Add($"{新号}(响应无id)");
                            else ids.Add(rid.Value);
                        }
                        else
                        {
                            logger.LogWarning("sprayplan 换号重推失败 {ExternalOrderNo} {Status}: {Body}", 新号, retry.StatusCode, rbody);
                            失败.Add($"{新号}({(int)retry.StatusCode})");
                        }
                        continue;
                    }
                    logger.LogWarning("sprayplan 建订单冲突 {ExternalOrderNo}: {Body}", draft.Order.ExternalOrderNo, body);
                    失败.Add($"{draft.Order.ExternalOrderNo}(409外部订单号已存在)");
                    continue;
                }
                if (!resp.IsSuccessStatusCode)
                {
                    logger.LogWarning("sprayplan 建订单失败 {ExternalOrderNo} {Status}: {Body}", draft.Order.ExternalOrderNo, resp.StatusCode, body);
                    失败.Add($"{draft.Order.ExternalOrderNo}({(int)resp.StatusCode})");
                    continue;
                }
                var id = ParseId(body) ?? (await FindOrderAsync(draft.Order.ExternalOrderNo!))?.Id;
                if (id is null) 失败.Add($"{draft.Order.ExternalOrderNo}(响应无id)");
                else ids.Add(id.Value);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "sprayplan 推送异常 {ExternalOrderNo}", draft.Order.ExternalOrderNo);
                失败.Add($"{draft.Order.ExternalOrderNo}({ex.Message})");
            }
        }
        return (ids, 失败);
    }

    // 从建单响应 JSON 解析 id;非 JSON/无 id 返回 null(调用方走列表兜底)
    private static long? ParseId(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("id", out var idEl) && idEl.TryGetInt64(out var v) ? v : null;
        }
        catch (JsonException) { return null; }
    }

    // 全部订单的 externalOrderNo 集合(含 archived——归档单也占号),换号重推时查重用
    private async Task<HashSet<string>> AllExternalOrderNosAsync()
    {
        var set = new HashSet<string>();
        using var resp = await GetAsync("orders");
        if (!resp.IsSuccessStatusCode) return set;
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        foreach (var o in doc.RootElement.EnumerateArray())
            if (o.TryGetProperty("externalOrderNo", out var no) && no.GetString() is { } s) set.Add(s);
        return set;
    }

    // 按 externalOrderNo 查订单(含 archived),返回 id+状态
    private async Task<(long Id, string? Status)?> FindOrderAsync(string externalOrderNo)
    {
        using var resp = await GetAsync("orders");
        if (!resp.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        foreach (var o in doc.RootElement.EnumerateArray())
            if (o.TryGetProperty("externalOrderNo", out var no) && no.GetString() == externalOrderNo
                && o.TryGetProperty("id", out var idEl) && idEl.TryGetInt64(out var id))
                return (id, o.TryGetProperty("status", out var st) ? st.GetString() : null);
        return null;
    }

    // 拉取全部入库申请单(append-only 台账;分页 pageSize=200 循环到取完)。
    // 反向同步器(SprayPlanSyncWorker)每趟调用,去重建单由 SprayPlanReceiptSyncService 负责。
    public async Task<List<SprayPlanInboundRow>> PullInboundApplicationsAsync()
    {
        var all = new List<SprayPlanInboundRow>();
        const int pageSize = 200;
        for (var page = 1; ; page++)
        {
            using var resp = await GetAsync($"inventory/inbound-applications?page={page}&pageSize={pageSize}");
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"sprayplan 拉取入库申请单失败({(int)resp.StatusCode}): {body}");
            var p = JsonSerializer.Deserialize<SprayPlanInboundPage>(body)
                ?? throw new InvalidOperationException($"sprayplan 入库申请单响应解析失败: {body}");
            if (p.Items.Count == 0) break;
            all.AddRange(p.Items);
            if (all.Count >= p.Total || p.Items.Count < pageSize) break;
        }
        return all;
    }

    // 逐个 DELETE /orders/{id}(软删到回收站);单个失败记警告并记入 失败Ids 不中断。
    // 调用方只清成功部分的本地推送记录,失败的保留待下次反审核/重推重试,防止远端残留单失联后重复推单。
    public async Task<SprayPlanDeleteResult> DeleteOrdersAsync(IEnumerable<long> ids)
    {
        var 警告 = new List<string>();
        var 失败Ids = new List<long>();
        foreach (var id in ids)
        {
            try
            {
                using var resp = await DeleteAsync($"orders/{id}");
                if (!resp.IsSuccessStatusCode)
                {
                    logger.LogWarning("sprayplan 删除失败 id={Id} {Status}", id, resp.StatusCode);
                    警告.Add($"喷油排期订单{id}删除失败({(int)resp.StatusCode})");
                    失败Ids.Add(id);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "sprayplan 删除异常 id={Id}", id);
                警告.Add($"喷油排期订单{id}删除异常({ex.Message})");
                失败Ids.Add(id);
            }
        }
        return new SprayPlanDeleteResult(警告, 失败Ids);
    }
}

// DeleteOrdersAsync 结果:警告文案 + 删除失败的远端订单 id(调用方据以保留对应本地推送记录)
public sealed record SprayPlanDeleteResult(List<string> 警告, List<long> 失败Ids);
