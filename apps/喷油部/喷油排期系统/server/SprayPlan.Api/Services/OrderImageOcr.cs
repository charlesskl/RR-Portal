using System.Diagnostics;
using System.Globalization;

namespace SprayPlan.Api.Services;

// 只在图片或无文字的扫描 PDF 上调用。OCR 在本机运行，不把业务订单上传到第三方。
// 运行环境需安装 tesseract(chi_sim + eng)；扫描 PDF 还需 pdftoppm。
public static class OrderImageOcr
{
    public static List<PdfWord> Extract(Stream source, string extension)
    {
        var work = Path.Combine(Path.GetTempPath(), "sprayplan_ocr_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            var input = Path.Combine(work, "order" + extension);
            using (var output = File.Create(input)) source.CopyTo(output);
            var images = new List<string>();
            if (extension == ".pdf")
            {
                var prefix = Path.Combine(work, "page");
                Run("pdftoppm", ["-r", "300", "-png", input, prefix]);
                images.AddRange(Directory.GetFiles(work, "page-*.png")
                    .OrderBy(path => int.TryParse(Path.GetFileNameWithoutExtension(path).Split('-').Last(), out var page) ? page : 0));
            }
            else images.Add(input);
            var words = new List<PdfWord>();
            for (var index = 0; index < images.Count; index++)
            {
                var tsv = Run("tesseract", [images[index], "stdout", "-l", "chi_sim+eng", "--psm", "11", "tsv"]);
                foreach (var line in tsv.Split('\n').Skip(1))
                {
                    var columns = line.TrimEnd('\r').Split('\t', 12);
                    if (columns.Length < 12 || columns[0] != "5") continue;
                    var value = columns[11].Trim();
                    if (value.Length == 0 || !double.TryParse(columns[10], NumberStyles.Float, CultureInfo.InvariantCulture, out var confidence) || confidence < 15) continue;
                    if (!double.TryParse(columns[6], out var left) || !double.TryParse(columns[7], out var top) ||
                        !double.TryParse(columns[8], out var width) || !double.TryParse(columns[9], out var height)) continue;
                    words.Add(new PdfWord(index + 1, value, left, left + width, 10000 - top - height, 10000 - top));
                }
            }
            return words;
        }
        finally
        {
            Directory.Delete(work, recursive: true);
        }
    }

    private static string Run(string command, IReadOnlyList<string> arguments)
    {
        var executable = new[] { "/opt/homebrew/bin/", "/usr/local/bin/", "/usr/bin/" }
            .Select(prefix => prefix + command).FirstOrDefault(File.Exists) ?? command;
        var start = new ProcessStartInfo(executable) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var arg in arguments) start.ArgumentList.Add(arg);
        try
        {
            using var process = Process.Start(start) ?? throw new InvalidOperationException($"无法启动 {command}");
            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(60000)) { process.Kill(entireProcessTree: true); throw new InvalidOperationException("图片识别超时"); }
            if (process.ExitCode != 0) throw new InvalidOperationException($"{command} 识别失败：{stderr.Trim()}");
            return stdout;
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            throw new InvalidOperationException($"图片识别组件 {command} 未安装", ex);
        }
    }
}
