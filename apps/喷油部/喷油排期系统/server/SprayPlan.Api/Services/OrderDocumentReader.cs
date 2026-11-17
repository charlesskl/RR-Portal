namespace SprayPlan.Api.Services;

public interface IOrderDocumentReader { List<PdfWord> Read(string token); }

public class OrderDocumentReader(PdfStorage pdf) : IOrderDocumentReader
{
    public List<PdfWord> Read(string token)
    {
        var extension = Path.GetExtension(token).ToLowerInvariant();
        if (extension == ".pdf")
        {
            using var source = pdf.Open(token);
            var words = PdfWordSource.Extract(source);
            if (PdfTableExtractor.ExtractRows(words).Count > 0) return words;
        }
        using var image = pdf.Open(token);
        return OrderImageOcr.Extract(image, extension);
    }
}
