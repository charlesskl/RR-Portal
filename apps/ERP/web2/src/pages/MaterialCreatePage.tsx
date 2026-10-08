// 物料快速建档(基础设置;老系统 web/src/pages/materials/MaterialCreateWizard.tsx 重写):
// 物料一处建档:一个页面建 来料/塑胶/原料 三种物料,新手不用记「这个料进哪个菜单」。
// 先选类别 → 填核心字段 → 保存写入对应库。细节专业字段(塑胶的模具日产量/啤机价钱等)建档后可到专页补。
// 来料编号留空由后端自动生成;塑胶/原料需填编号。
// 权限菜单=物料资料(老菜单树 menuTree.tsx:M("物料快速建档","/material-create","物料资料"))。
import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Prohibit, SealCheck } from "@phosphor-icons/react";
import { masterDataApi, materialMasterApi } from "@/api/endpoints";
import { usePerms } from "@/hooks/usePerms";
import { MENU_PATHS } from "@/nav/menu";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";

const MENU = "物料资料";

type CategoryKey = "materials" | "plastic-materials" | "plastic-raw-materials";

const CATEGORIES: { key: CategoryKey; label: string; hint: string }[] = [
  { key: "materials", label: "来料物料", hint: "辅料/包装/五金等(编号留空自动生成)" },
  { key: "plastic-materials", label: "塑胶物料", hint: "注塑胶件/半成品" },
  { key: "plastic-raw-materials", label: "塑胶原料", hint: "PVC/ABS 等原料" },
];

const UNITS = ["个"];

const plasticMaterials = masterDataApi("plastic-materials");
const plasticRawMaterials = masterDataApi("plastic-raw-materials");

export default function MaterialCreatePage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();
  const [cat, setCat] = useState<CategoryKey>("materials");
  const [form, setForm] = useState<Record<string, string>>({ 单位: "个" });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const autoCode = cat === "materials";
  const patch = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // 专页跳转目标:来料/塑胶本批已注册;塑胶原料资料表在后续批次(未注册不跳断链)
  const detailPath =
    cat === "materials"
      ? "/material-master"
      : cat === "plastic-materials"
        ? "/plastic-material-master"
        : "/plastic-raw-material-master";
  const goDetail = () => {
    if (MENU_PATHS.has(detailPath)) navigate(detailPath);
    else setToast({ text: "塑胶原料资料表后续批次上线", tone: "ok" });
  };

  const save = async () => {
    // 必填校验:物料名称必填;塑胶/原料 物料编号必填(照抄老系统 Form rules)
    if (!form.物料名称?.trim()) {
      setToast({ text: "请填物料名称", tone: "err" });
      return;
    }
    if (!autoCode && !form.物料编号?.trim()) {
      setToast({ text: "请填物料编号", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        物料编号: form.物料编号?.trim() || undefined, // 来料留空后端自动生成
        物料名称: form.物料名称,
        物料类别: form.物料类别 || undefined,
        规格: form.规格 || undefined,
        颜色: form.颜色 || undefined,
        单位: form.单位 ?? "个",
        单价: form.单价 ? Number(form.单价) : undefined,
        备注: form.备注 || undefined,
      };
      if (cat === "materials") {
        Object.assign(body, {
          供应商编号: form.供应商编号 || undefined,
          仓库位置: form.仓库位置 || undefined,
          销售价: form.销售价 ? Number(form.销售价) : undefined,
        });
        await materialMasterApi.create(body);
      } else if (cat === "plastic-materials") {
        Object.assign(body, {
          工模编号: form.工模编号 || undefined,
          款号: form.款号 || undefined,
          客户编号: form.客户编号 || undefined,
        });
        await plasticMaterials.create(body);
      } else {
        Object.assign(body, {
          商品名称: form.商品名称 || undefined,
          产地: form.产地 || undefined,
          每包重量: form.每包重量 ? Number(form.每包重量) : undefined,
          安全库存: form.安全库存 ? Number(form.安全库存) : undefined,
          起订量: form.起订量 ? Number(form.起订量) : undefined,
        });
        await plasticRawMaterials.create(body);
      }
      setToast({ text: `${CATEGORIES.find((c) => c.key === cat)!.label}已建档`, tone: "ok" });
      setForm({ 单位: "个" });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "建档失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问物料快速建档"
            description="缺少「物料资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const txt = (name: string, label: string, required = false, placeholder?: string) => (
    <label key={name} className="block">
      <span className="f-label">
        {label}
        {required && <span className="text-[#dc2626]"> *</span>}
      </span>
      <input
        aria-label={label}
        className="f-input f-input-slim mt-1.5"
        placeholder={placeholder}
        value={form[name] ?? ""}
        onChange={(e) => patch(name, e.target.value)}
      />
    </label>
  );

  return (
    <div className="f-page mx-auto max-w-[980px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">物料快速建档(一处建档)</h1>
        <button
          type="button"
          className="f-btn f-btn-cyan ml-auto h-10 px-5"
          disabled={saving}
          onClick={() => void save()}
        >
          <SealCheck className="h-4.5 w-4.5" />
          保存
        </button>
      </div>

      <div className="f-panel space-y-5 p-5">
        <div>
          <div className="f-label mb-2">
            物料类别(先选这个,决定进哪个库)<span className="text-[#dc2626]"> *</span>
          </div>
          <div className="flex gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1 sm:w-fit">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCat(c.key)}
                className={cn(
                  "h-9 rounded-lg px-4 text-sm transition-colors",
                  cat === c.key
                    ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                    : "text-[#5f6b7d] hover:text-[#3d4a5c]",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-xs text-disabled">
            {CATEGORIES.find((c) => c.key === cat)!.hint}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          {txt("物料编号", autoCode ? "物料编号(留空自动)" : "物料编号", !autoCode, autoCode ? "留空自动生成" : "请输入编号")}
          {txt("物料名称", "物料名称", true)}
          {txt("物料类别", "小类/类别")}
          <label className="block">
            <span className="f-label">单位</span>
            <SearchSelect
              ariaLabel="单位"
              className="mt-1.5"
              value={form.单位 ?? "个"}
              options={UNITS.map((u) => ({ value: u, label: u }))}
              onChange={(v) => patch("单位", v)}
            />
          </label>
          <label className="block">
            <span className="f-label">单价</span>
            <input
              aria-label="单价"
              type="number"
              min={0}
              step="0.0001"
              className="f-input f-input-slim mt-1.5"
              value={form.单价 ?? ""}
              onChange={(e) => patch("单价", e.target.value)}
            />
          </label>
          {txt("规格", "规格")}
          {txt("颜色", "颜色")}
          {cat === "materials" && txt("供应商编号", "供应商编号")}
          {cat === "materials" && txt("仓库位置", "仓库位置")}
          {cat === "plastic-materials" && txt("工模编号", "工模编号")}
          {cat === "plastic-materials" && txt("款号", "款号")}
          {cat === "plastic-raw-materials" && txt("商品名称", "商品名称")}
          {cat === "plastic-raw-materials" && txt("产地", "产地")}
          {cat === "plastic-raw-materials" && (
            <label className="block">
              <span className="f-label">每包重量</span>
              <input
                aria-label="每包重量"
                type="number"
                min={0}
                className="f-input f-input-slim mt-1.5"
                value={form.每包重量 ?? ""}
                onChange={(e) => patch("每包重量", e.target.value)}
              />
            </label>
          )}
          <label className="col-span-2 block md:col-span-4">
            <span className="f-label">备注</span>
            <input
              aria-label="备注"
              className="f-input f-input-slim mt-1.5"
              value={form.备注 ?? ""}
              onChange={(e) => patch("备注", e.target.value)}
            />
          </label>
        </div>

        <div className="text-xs text-[#5f6b7d]">
          这是快速建档:先把料建起来。塑胶的模具日产量/啤机价钱、原料的起订量等专业字段,建档后可到对应专页补全。
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-0.5 font-medium text-[#15803d] hover:underline"
            onClick={goDetail}
          >
            去专页补全细节
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
