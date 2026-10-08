namespace ErpApi.Features.Styles;

public static class StyleMaterialsPricePolicy
{
    public static StyleMaterialsViewDto Redact(StyleMaterialsViewDto dto) => dto with
    {
        扩展 = dto.扩展 is null ? null : dto.扩展 with { 库存单价HK = null, 其他成本HK = null },
        报价 = dto.报价?.Select(Redact).ToList()
    };

    public static BomSaveDto PreserveProtectedPrices(
        BomSaveDto incoming,
        AssemblyMaterialExtensionDto? existingExtension,
        IReadOnlyList<AssemblyMaterialQuoteDto> existingQuotes)
    {
        var extension = incoming.扩展 is null
            ? null
            : incoming.扩展 with
            {
                库存单价HK = existingExtension?.库存单价HK,
                其他成本HK = existingExtension?.其他成本HK
            };

        List<AssemblyMaterialQuoteDto>? quotes = null;
        if (incoming.报价 is not null)
        {
            quotes = incoming.报价.Select(quote =>
            {
                var existing = FindExistingQuote(quote, existingQuotes);
                return quote with
                {
                    单价 = existing?.单价,
                    港币价 = existing?.港币价,
                    对比相差 = existing?.对比相差,
                    相差比例 = existing?.相差比例
                };
            }).ToList();
        }

        return incoming with { 扩展 = extension, 报价 = quotes };
    }

    private static AssemblyMaterialQuoteDto Redact(AssemblyMaterialQuoteDto quote) => quote with
    {
        单价 = null,
        港币价 = null,
        对比相差 = null,
        相差比例 = null
    };

    private static AssemblyMaterialQuoteDto? FindExistingQuote(
        AssemblyMaterialQuoteDto incoming,
        IReadOnlyList<AssemblyMaterialQuoteDto> existingQuotes)
    {
        if (incoming.ID is not null)
            return existingQuotes.FirstOrDefault(existing => existing.ID == incoming.ID);

        return existingQuotes.FirstOrDefault(existing =>
            existing.物料编号 == incoming.物料编号 &&
            existing.合作方类型 == incoming.合作方类型 &&
            existing.合作方编号 == incoming.合作方编号 &&
            existing.顺序 == incoming.顺序);
    }
}
