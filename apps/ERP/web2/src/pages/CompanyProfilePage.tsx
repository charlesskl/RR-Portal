// 基本资料(公司资料;/system/company-profile;老系统 web/src/pages/system/CompanyProfilePage.tsx 重写):
// 一组存于系统配置表的键值(公司.名称/地址/电话/传真/备注),后端固定键白名单;
// 标签与顺序由后端 GET /company-profile 返回,前端逐项渲染输入框;保存=PUT 全量键值。
// 权限菜单=基本资料(MenuCatalog.cs:99 实证:系统管理组);无「保存」位时输入框只读、无保存按钮。
import { useEffect, useState } from "react";
import { Prohibit } from "@phosphor-icons/react";
import { companyProfileApi } from "@/api/endpoints";
import type { SettingItem } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";

const MENU = "基本资料";
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function CompanyProfilePage() {
  const { can, loading: permsLoading } = usePerms();
  const editable = can(MENU, "保存");
  const [items, setItems] = useState<SettingItem[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    // 微任务里拉取:setState 不在 effect 同步路径
    void Promise.resolve().then(async () => {
      setLoading(true);
      try {
        const rows = await companyProfileApi.get();
        setItems(rows);
        setForm(Object.fromEntries(rows.map((r) => [r.键, r.值 ?? ""])));
      } catch (e) {
        setToast({ text: errMsg(e, "加载公司资料失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await companyProfileApi.save(form);
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
            title="无权访问基本资料"
            description="缺少「基本资料」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-3xl space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">基本资料(公司资料)</h1>
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
      <div className="f-panel p-6">
        {loading ? (
          <div className="py-10 text-center text-sm text-disabled">加载中...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {items.map((it) => (
              <label key={it.键} className="block">
                <span className="f-label">{it.标签}</span>
                <input
                  aria-label={it.标签}
                  className="f-input f-input-slim mt-1.5"
                  placeholder={`请输入${it.标签}`}
                  disabled={!editable}
                  value={form[it.键] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [it.键]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        )}
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
