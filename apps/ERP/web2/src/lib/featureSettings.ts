// 功能设置(系统.默认货币/单价小数位/数量小数位)的前端消费钩子。
// 照抄老系统 web/src/auth/featureSettings.ts,API 层换成 web2 的 lib/api。
// 登录后首次使用拉一次并模块级缓存;拉取失败回落默认值(不缓存失败,下次重试),不阻塞页面。
import { useEffect, useState } from "react";
import { api } from "./api";

export interface FeatureSettings {
  默认货币: string; // HKD/RMB/USD/EUR(与后端 FeatureSettingsRules.支持货币 一致)
  单价小数位: number; // 0-6
  数量小数位: number; // 0-6
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  默认货币: "HKD",
  单价小数位: 4,
  数量小数位: 2,
};

interface SettingItem {
  键?: string;
  值?: string | null;
}

const SUPPORTED_CURRENCIES = ["HKD", "RMB", "USD", "EUR"];

const clampDigits = (value: string | null | undefined, fallback: number): number => {
  if (value == null || String(value).trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback;
};

// 解析后端 SettingItem[] → FeatureSettings;缺键/非法值逐项回落默认。
export function parseFeatureSettings(items: SettingItem[]): FeatureSettings {
  const get = (k: string) => items.find((i) => i.键 === k)?.值 ?? null;
  const currency = (get("系统.默认货币") ?? "").trim().toUpperCase();
  return {
    默认货币: SUPPORTED_CURRENCIES.includes(currency)
      ? currency
      : DEFAULT_FEATURE_SETTINGS.默认货币,
    单价小数位: clampDigits(get("系统.单价小数位"), DEFAULT_FEATURE_SETTINGS.单价小数位),
    数量小数位: clampDigits(get("系统.数量小数位"), DEFAULT_FEATURE_SETTINGS.数量小数位),
  };
}

// 功能设置的货币代码(HKD) → 单据/报价沿用写法(HK$);其余代码原样返回。
export function toDocCurrency(code: string): string {
  const c = (code ?? "").trim().toUpperCase();
  return c === "HKD" ? "HK$" : c;
}

let cache: FeatureSettings | null = null;
let inflight: Promise<FeatureSettings> | null = null;

export function loadFeatureSettings(): Promise<FeatureSettings> {
  if (cache) return Promise.resolve(cache);
  inflight ??= Promise.resolve()
    .then(() => api<SettingItem[]>("/feature-settings/public"))
    .then((items) => (cache = parseFeatureSettings(items)))
    .catch(() => DEFAULT_FEATURE_SETTINGS)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useFeatureSettings(): FeatureSettings {
  const [settings, setSettings] = useState<FeatureSettings>(cache ?? DEFAULT_FEATURE_SETTINGS);
  useEffect(() => {
    let alive = true;
    void loadFeatureSettings().then((v) => {
      if (alive) setSettings(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

// 测试用:清空模块缓存
export function __resetFeatureSettingsCache(): void {
  cache = null;
  inflight = null;
}
