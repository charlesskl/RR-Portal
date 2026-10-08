// 功能设置(/system/feature-settings;老系统 web/src/pages/system/FeatureSettingsPage.tsx 重写):
// 系统级参数(默认货币/单价小数位/数量小数位),存于系统配置表;
// 默认货币下拉 HKD/RMB/USD/EUR(后端白名单,FeatureSettingsRules.支持货币),小数位 0-6 整数;
// 缺键回落默认 HKD/4/2(对照老系统 form.setFieldsValue 默认值)。
// 权限菜单=功能设置(MenuCatalog.cs:100 实证:系统管理组);无「保存」位时控件只读。
import { useEffect, useState } from "react";
import { Prohibit } from "@phosphor-icons/react";
import { featureSettingsApi } from "@/api/endpoints";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "功能设置";
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;
const 货币键 = "系统.默认货币";
const 单价小数位键 = "系统.单价小数位";
const 数量小数位键 = "系统.数量小数位";
const CURRENCIES = ["HKD", "RMB", "USD", "EUR"];

export default function FeatureSettingsPage() {
  const { can, loading: permsLoading } = usePerms();
  const editable = can(MENU, "保存");
  const [货币, set货币] = useState("HKD");
  const [单价小数位, set单价小数位] = useState(4);
  const [数量小数位, set数量小数位] = useState(2);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      setLoading(true);
      try {
        const rows = await featureSettingsApi.get();
        const get = (k: string) => rows.find((r) => r.键 === k)?.值;
        set货币(get(货币键) ?? "HKD");
        set单价小数位(Number(get(单价小数位键) ?? 4));
        set数量小数位(Number(get(数量小数位键) ?? 2));
      } catch (e) {
        setToast({ text: errMsg(e, "加载功能设置失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await featureSettingsApi.save({
        [货币键]: 货币,
        [单价小数位键]: String(单价小数位),
        [数量小数位键]: String(数量小数位),
      });
      setToast({ text: "已保存", tone: "ok" });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  if (!permsLoading && !can(MENU, "打开") && !editable) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问功能设置"
            description="缺少「功能设置」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-xl space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">功能设置</h1>
        {editable && (
          <button
            type="button"
            className="f-btn f-btn-cyan ml-auto h-9 px-5 text-sm"
            disabled={saving || loading}
            onClick={() => void save()}
          >
            保存
          </button>
        )}
      </div>
      <div className="f-panel space-y-4 p-6">
        <label className="block">
          <span className="f-label">
            默认货币<span className="text-[#dc2626]"> *</span>
          </span>
          <SearchSelect
            ariaLabel="默认货币"
            className="mt-1.5"
            disabled={!editable}
            value={货币}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            onChange={(v) => set货币(v)}
          />
        </label>
        <label className="block">
          <span className="f-label">
            单价小数位<span className="text-[#dc2626]"> *</span>
          </span>
          <input
            aria-label="单价小数位"
            type="number"
            min={0}
            max={6}
            step={1}
            className="f-input f-input-slim mt-1.5"
            disabled={!editable}
            value={单价小数位}
            onChange={(e) => set单价小数位(Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className="f-label">
            数量小数位<span className="text-[#dc2626]"> *</span>
          </span>
          <input
            aria-label="数量小数位"
            type="number"
            min={0}
            max={6}
            step={1}
            className="f-input f-input-slim mt-1.5"
            disabled={!editable}
            value={数量小数位}
            onChange={(e) => set数量小数位(Number(e.target.value))}
          />
        </label>
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
