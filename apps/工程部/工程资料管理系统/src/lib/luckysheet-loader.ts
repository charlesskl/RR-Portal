/**
 * Luckysheet + LuckyExcel 静态资源按需加载器
 * 资源在 public/luckysheet/ 下，以绝对路径 /luckysheet/* 访问
 */

declare global {
  interface Window {
    luckysheet?: any;
    LuckyExcel?: any;
    $?: any;
  }
}

const BASE = "luckysheet";

let loadingPromise: Promise<void> | null = null;

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`加载失败: ${src}`)));
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

/** 加载 Luckysheet 与 LuckyExcel，只加载一次 */
export function ensureLuckysheet(): Promise<void> {
  if (window.luckysheet && window.LuckyExcel) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadCss(`${BASE}/plugins/css/pluginsCss.css`);
  loadCss(`${BASE}/plugins/plugins.css`);
  loadCss(`${BASE}/css/luckysheet.css`);
  loadCss(`${BASE}/assets/iconfont/iconfont.css`);
  loadingPromise = (async () => {
    await loadScript(`${BASE}/plugins/js/plugin.js`);
    await loadScript(`${BASE}/luckysheet.umd.js`);
    await loadScript(`${BASE}/luckyexcel.umd.js`);
    if (!window.luckysheet) throw new Error("luckysheet 初始化失败");
    if (!window.LuckyExcel) throw new Error("luckyexcel 初始化失败");
  })();
  return loadingPromise;
}
