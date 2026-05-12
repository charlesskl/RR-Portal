const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 用系统 pdftoppm 把 PDF 转成 PNG（每页一张）
 * 服务器需安装 poppler-utils:
 *   - Alpine: apk add poppler-utils
 *   - Debian/Ubuntu: apt install poppler-utils
 *   - macOS: brew install poppler
 * 返回 { tmpDir, files } - PNG 文件路径数组
 */
function pdfToImages(pdfPath, dpi = 150) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2img-'));
  const prefix = path.join(tmpDir, 'page');

  // Windows 本地 fallback：使用打包的 poppler-windows
  let pdftoppmCmd = 'pdftoppm';
  if (process.platform === 'win32') {
    const winPath = 'C:/Users/Administrator/tools/poppler-24.08.0/Library/bin/pdftoppm.exe';
    if (fs.existsSync(winPath)) pdftoppmCmd = winPath;
  }

  const result = spawnSync(pdftoppmCmd, ['-png', '-r', String(dpi), pdfPath, prefix], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`pdftoppm 不可用 (需安装 poppler-utils): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pdftoppm 转换失败 (exit ${result.status}): ${result.stderr || result.stdout}`);
  }

  const files = fs.readdirSync(tmpDir)
    .filter(f => f.startsWith('page') && f.endsWith('.png'))
    .sort()
    .map(f => path.join(tmpDir, f));

  return { tmpDir, files };
}

function cleanupTmp(tmpDir) {
  try {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) { /* ignore */ }
}

module.exports = { pdfToImages, cleanupTmp };
