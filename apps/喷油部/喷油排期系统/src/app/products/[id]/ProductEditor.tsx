"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { sumUnitCost, sumLaborPrice, sumPaintCost, sumQuotedPrice, CRAFTS } from "@/lib/product";

// ─── 数据类型 ─────────────────────────────────────────────────
type Part = { id: number; partName: string; craft: string; unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number; dailyCapacity: number; craftPasses: number };
type Item = { id: number; itemName: string; parts: Part[] };

// 弹窗内表单用的部位行（全字符串，提交时再转数字）
type PartForm = { partName: string; craft: string; unitCost: string; laborPrice: string; paintCost: string; quotedPrice: string; dailyCapacity: string; craftPasses: string };
const emptyPart = (): PartForm => ({ partName: "", craft: "移印", unitCost: "", laborPrice: "", paintCost: "", quotedPrice: "", dailyCapacity: "", craftPasses: "" });

// 数字转换：空字符串→0，否则转 Number
const num = (s: string) => (s === "" ? 0 : Number(s));

const cleanPartName = (s: string) => s.trim();
const partNameKey = (s: string) => cleanPartName(s).replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, "").toLowerCase();
const uniqueNames = (names: string[]) => Array.from(new Set(names.map(cleanPartName).filter(Boolean)));

function partNameSuggestion(value: string, existingNames: string[]) {
  const key = partNameKey(value);
  if (!key) return "";
  return uniqueNames(existingNames).find((n) => partNameKey(n) === key && n !== cleanPartName(value)) ?? "";
}

function effectivePassesByPartName(parts: PartForm[]) {
  const m = new Map<string, number>();
  for (const p of parts) {
    const name = cleanPartName(p.partName);
    const passes = Math.max(0, Math.trunc(num(p.craftPasses)));
    if (name && passes > 0 && !m.has(name)) m.set(name, passes);
  }
  return m;
}

function validatePartForms(parts: PartForm[]) {
  for (const p of parts) {
    if (!cleanPartName(p.partName)) return "每个部位都必须填写部位名";
    if (p.craftPasses && num(p.craftPasses) < 1) return "工序道数至少为 1";
  }

  const normalized = new Map<string, Set<string>>();
  for (const p of parts) {
    const key = partNameKey(p.partName);
    if (!normalized.has(key)) normalized.set(key, new Set());
    normalized.get(key)!.add(cleanPartName(p.partName));
  }
  for (const names of Array.from(normalized.values())) {
    if (names.size > 1) return `发现疑似重复部位：${Array.from(names).join(" / ")}。请统一部位名称后再保存。`;
  }

  const groups = new Map<string, PartForm[]>();
  for (const p of parts) {
    const name = cleanPartName(p.partName);
    groups.set(name, [...(groups.get(name) ?? []), p]);
  }
  for (const [name, rows] of Array.from(groups.entries())) {
    const passes = Array.from(new Set(rows.map((p) => Math.max(0, Math.trunc(num(p.craftPasses)))).filter((v) => v > 0)));
    if (passes.length > 1) return `${name} 的工序道数不一致：${passes.join("、")}。请统一后再保存。`;
    const craftCount = new Set(rows.map((p) => p.craft).filter(Boolean)).size;
    const effective = passes[0] ?? 0;
    if (effective > 0 && effective < craftCount) return `${name} 已有 ${craftCount} 个工序，工序道数不能小于 ${craftCount}。`;
  }
  return "";
}

// ─── 样式常量（与 new/page.tsx 一致）────────────────────────
const inp = "w-full border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400";
const cell = "w-full border border-app-border rounded px-2 py-1 text-sm focus:outline-none focus:border-mint-400";

// 底部取消按钮（次操作：白底 + 边框）
const btnCancel = "px-4 py-2 border border-[#e5e7eb] rounded-[12px] text-sm font-semibold text-[#6b7280] bg-white hover:bg-[#f3f4f6] transition-all";
// 底部保存按钮（主操作：薄荷绿）
const btnSave = "px-4 py-2 rounded-[12px] text-sm font-semibold text-white bg-[#34d399] hover:bg-[#059669] shadow-[0_2px_8px_rgba(52,211,153,0.30)] transition-all disabled:opacity-60 disabled:cursor-not-allowed";

// 表单 label 组件
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-[#6b7280] mb-1">{label}</label>{children}</div>;
}

// ─── 主组件 ──────────────────────────────────────────────────
export function ProductEditor({ productId, items }: { productId: number; items: Item[] }) {
  const router = useRouter();
  const [draftItems, setDraftItems] = useState<Item[]>(items);
  const [dirty, setDirty] = useState(false);
  const [tableSaving, setTableSaving] = useState(false);

  // 行内编辑（改部位价格）
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    setDraftItems(items);
    setDirty(false);
    setEditing(null);
  }, [items]);

  // ── 弹窗状态：用一个联合对象管理三种弹窗 ──────────────────
  // mode=null 表示全部关闭
  type DialogState =
    | { mode: "addItem" }
    | { mode: "addPart"; itemId: number }
    | { mode: null };

  const [dlg, setDlg] = useState<DialogState>({ mode: null });

  // ── 弹窗 A（加子件）内部状态 ──────────────────────────────
  const [newItemName, setNewItemName] = useState("");
  const [newItemParts, setNewItemParts] = useState<PartForm[]>([emptyPart()]);
  const [itemSaving, setItemSaving] = useState(false);

  // 打开加子件弹窗 → 初始化表单
  function openAddItem() {
    setNewItemName(""); setNewItemParts([emptyPart()]);
    setDlg({ mode: "addItem" });
  }

  // 加子件弹窗：更新指定部位行字段
  const updNewPart = (pi: number, patch: Partial<PartForm>) =>
    setNewItemParts(newItemParts.map((p, i) => (i === pi ? { ...p, ...patch } : p)));

  // 加子件弹窗：提交
  async function submitAddItem() {
    if (!newItemName.trim()) { alert("请填写子件名"); return; }
    for (const p of newItemParts) {
      if (!p.partName.trim()) { alert("每个部位都必须填部位名"); return; }
    }
    const formError = validatePartForms(newItemParts);
    if (formError) { alert(formError); return; }
    const passesByPart = effectivePassesByPartName(newItemParts);
    setItemSaving(true);
    const body = {
      itemName: newItemName.trim(),
      parts: newItemParts.map((p, pi) => ({
        partName: p.partName.trim(), partOrder: pi, craft: p.craft,
        unitCost: num(p.unitCost), laborPrice: num(p.laborPrice),
        paintCost: num(p.paintCost), quotedPrice: num(p.quotedPrice),
        dailyCapacity: num(p.dailyCapacity),
        craftPasses: passesByPart.get(p.partName.trim()) ?? num(p.craftPasses),
      })),
    };
    const res = await apiFetch(`/api/products/${productId}/items`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setItemSaving(false);
    if (res.ok) { setDlg({ mode: null }); router.refresh(); }
    else { const b = await res.json(); alert("新增失败：" + (b.error || "未知错误")); }
  }

  // ── 弹窗 B（加部位）内部状态 ──────────────────────────────
  const [newPartForm, setNewPartForm] = useState<PartForm>(emptyPart());
  const [partSaving, setPartSaving] = useState(false);

  // 打开加部位弹窗
  function openAddPart(itemId: number) {
    setNewPartForm(emptyPart());
    setDlg({ mode: "addPart", itemId });
  }

  // 加部位弹窗：提交
  async function submitAddPart(itemId: number) {
    if (!newPartForm.partName.trim()) { alert("请填写部位名"); return; }
    // 工序道数若填了，至少为 1（道数 ≥ 工序种类数的完整校验留方式A录入期做）
    if (newPartForm.craftPasses && Number(newPartForm.craftPasses) < 1) {
      alert("工序道数至少为 1"); return;
    }
    setPartSaving(true);
    const body = {
      itemId,
      partName: newPartForm.partName.trim(),
      craft: newPartForm.craft,
      unitCost: num(newPartForm.unitCost),
      laborPrice: num(newPartForm.laborPrice),
      paintCost: num(newPartForm.paintCost),
      quotedPrice: num(newPartForm.quotedPrice),
      dailyCapacity: num(newPartForm.dailyCapacity),
      craftPasses: num(newPartForm.craftPasses),
    };
    const res = await apiFetch(`/api/products/${productId}/parts`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setPartSaving(false);
    if (res.ok) { setDlg({ mode: null }); router.refresh(); }
    else { const b = await res.json(); alert("新增失败：" + (b.error || "未知错误")); }
  }

  // ── 行内操作（保留 confirm）──────────────────────────────
  function savePart(partId: number, patch: Partial<Part>) {
    setDraftItems((curr) => curr.map((it) => ({
      ...it,
      parts: it.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)),
    })));
    setDirty(true);
    setEditing(null);
  }

  async function savePartNow(partId: number, patch: Partial<Part>) {
    const res = await apiFetch(`/api/products/${productId}/parts/${partId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (res.ok) { setEditing(null); router.refresh(); } else alert("保存失败：" + (await res.json()).error);
  }
  async function savePricingTable() {
    for (const it of draftItems) {
      const forms: PartForm[] = it.parts.map((p) => ({
        partName: p.partName,
        craft: p.craft,
        unitCost: String(p.unitCost ?? ""),
        laborPrice: String(p.laborPrice ?? ""),
        paintCost: String(p.paintCost ?? ""),
        quotedPrice: String(p.quotedPrice ?? ""),
        dailyCapacity: String(p.dailyCapacity ?? ""),
        craftPasses: p.craftPasses ? String(p.craftPasses) : "",
      }));
      const formError = validatePartForms(forms);
      if (formError) { alert(`${it.itemName}：${formError}`); return; }
    }

    setTableSaving(true);
    const res = await apiFetch(`/api/products/${productId}/parts`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: draftItems.flatMap((it) => it.parts.map((p) => ({
          id: p.id,
          partName: p.partName,
          craft: p.craft,
          unitCost: p.unitCost,
          laborPrice: p.laborPrice,
          paintCost: p.paintCost,
          quotedPrice: p.quotedPrice,
          dailyCapacity: p.dailyCapacity,
          craftPasses: p.craftPasses,
        }))),
      }),
    });
    setTableSaving(false);
    if (res.ok) {
      setDirty(false);
      setEditing(null);
      router.refresh();
    } else {
      const b = await res.json();
      alert("保存失败：" + (b.error || "未知错误"));
    }
  }

  async function delPart(partId: number) {
    if (!confirm("确认删除该部位？")) return;
    const res = await apiFetch(`/api/products/${productId}/parts/${partId}`, { method: "DELETE" });
    if (res.ok) router.refresh(); else alert("删除失败");
  }
  async function delItem(itemId: number) {
    if (!confirm("确认删除该子件（连同部位）？")) return;
    const res = await apiFetch(`/api/products/${productId}/items/${itemId}`, { method: "DELETE" });
    if (res.ok) router.refresh(); else alert("删除失败");
  }

  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-card border border-app-border bg-white px-5 py-3">
        <div className="text-sm text-text-secondary">{dirty ? "有未保存修改" : "核价表已保存"}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-4 py-2 border border-app-border rounded-[12px] text-sm font-semibold text-[#6b7280] bg-white hover:bg-[#f3f4f6] disabled:opacity-50"
            disabled={!dirty || tableSaving}
            onClick={() => { setDraftItems(items); setDirty(false); setEditing(null); }}
          >
            撤销修改
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-[12px] text-sm font-semibold text-white bg-[#34d399] hover:bg-[#059669] disabled:opacity-60"
            disabled={!dirty || tableSaving}
            onClick={savePricingTable}
          >
            {tableSaving ? "保存中..." : "保存核价表"}
          </button>
        </div>
      </div>
      {/* ── 子件列表 ─────────────────────────────────────── */}
      {draftItems.map((it) => (
        <div key={it.id} className="bg-white rounded-card border border-app-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-bold text-sm">📦 {it.itemName}</span>
            {/* 子件小计：核价 / 人工 / 油漆 / 报价 各列加总，放在子件名旁边 */}
            <span className="flex items-center gap-3 text-xs text-text-secondary">
              <span>核价 <b className="text-text text-sm">{sumUnitCost(it.parts).toFixed(3)}</b></span>
              <span>人工 <b className="text-text text-sm">{sumLaborPrice(it.parts).toFixed(3)}</b></span>
              <span>油漆 <b className="text-text text-sm">{sumPaintCost(it.parts).toFixed(3)}</b></span>
              <span>报价 <b className="text-text text-sm">{sumQuotedPrice(it.parts).toFixed(3)}</b></span>
              <span className="text-mint-700">总核价 <b className="text-sm">{(sumUnitCost(it.parts) + sumPaintCost(it.parts)).toFixed(3)}</b></span>
            </span>
            <button className="text-rose text-xs ml-auto" onClick={() => delItem(it.id)}>删子件</button>
          </div>
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[18%]" /><col className="w-[11%]" /><col className="w-[8%]" /><col className="w-[9%]" /><col className="w-[9%]" />
              <col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[8%]" />
            </colgroup>
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs [&>tr+tr]:hidden">
              <tr><th className="px-2 py-2 text-left">部位</th><th>工序</th><th>道数</th><th>核价</th><th>人工</th><th>油漆</th><th className="text-mint-700">总核价</th><th>报价</th><th>日产能</th><th>操作</th></tr>
              <tr><th className="px-2 py-2 text-left">部位</th><th>工序</th><th>核价</th><th>人工</th><th>油漆</th><th className="text-mint-700">总核价</th><th>报价</th><th>日产能</th><th>操作</th></tr>
            </thead>
            <tbody>
              {it.parts.map((p) => (
                editing === p.id
                  ? <PartRowEdit key={p.id} part={p} onSave={(patch) => savePart(p.id, patch)} onCancel={() => setEditing(null)} />
                  : <PartRowView key={p.id} part={p} onEdit={() => setEditing(p.id)} onDelete={() => delPart(p.id)} />
              ))}
            </tbody>
          </table>
          <button className="text-mint-700 text-sm mt-3" onClick={() => openAddPart(it.id)}>+ 添加部位</button>
        </div>
      ))}
      <button className="text-mint-700 text-sm" onClick={openAddItem}>+ 添加子件</button>

      {/* ══════════════════════════════════════════════════ */}
      {/* 弹窗 A：加子件（含部位明细表）                     */}
      {/* ══════════════════════════════════════════════════ */}
      <Dialog open={dlg.mode === "addItem"} onOpenChange={(open) => { if (!open) setDlg({ mode: null }); }}>
        <DialogContent className="max-w-[900px] rounded-[16px] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle className="text-[18px] font-semibold text-[#0f172a]">新增子件</DialogTitle>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* 顶部主信息：子件名 */}
            <L label="子件名 *">
              <input
                className={inp}
                placeholder="如 兔子"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
              />
            </L>

            {/* 部位明细表 */}
            <div>
              <p className="text-xs font-medium text-[#6b7280] mb-2">部位明细</p>
              <table className="w-full text-sm">
                <thead className="bg-[#f0fdf4] text-[#047857] text-xs [&>tr+tr]:hidden">
                  <tr>
                    <th className="px-2 py-2 text-left">部位名*</th>
                    <th className="px-2 py-2">工序</th>
                    <th className="px-2 py-2">道数</th>
                    <th className="px-2 py-2">核价</th>
                    <th className="px-2 py-2">人工</th>
                    <th className="px-2 py-2">油漆</th>
                    <th className="px-2 py-2 text-mint-700">总核价</th>
                    <th className="px-2 py-2">报价</th>
                    <th className="px-2 py-2">日产能</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                  <tr>
                    <th className="px-2 py-2 text-left">部位名 *</th>
                    <th className="px-2 py-2">工序</th>
                    <th className="px-2 py-2">核价</th>
                    <th className="px-2 py-2">人工</th>
                    <th className="px-2 py-2">油漆</th>
                    <th className="px-2 py-2 text-mint-700">总核价</th>
                    <th className="px-2 py-2">报价</th>
                    <th className="px-2 py-2">日产能</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {newItemParts.map((p, pi) => (
                    <tr key={pi} className={pi % 2 === 1 ? "bg-[#f9fafb]" : ""}>
                      <td className="px-1 py-1">
                        <input className={cell} placeholder="如 头" value={p.partName}
                          onChange={(e) => updNewPart(pi, { partName: e.target.value })} />
                        {partNameSuggestion(p.partName, newItemParts.filter((_, i) => i !== pi).map((x) => x.partName)) && (
                          <button
                            type="button"
                            className="mt-1 text-[11px] text-[#047857] hover:underline"
                            onClick={() => updNewPart(pi, { partName: partNameSuggestion(p.partName, newItemParts.filter((_, i) => i !== pi).map((x) => x.partName)) })}
                          >
                            可能是已有部位，点击使用标准名称
                          </button>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <select className={cell} value={p.craft}
                          onChange={(e) => updNewPart(pi, { craft: e.target.value })}>
                          {CRAFTS.map((c2) => <option key={c2} value={c2}>{c2}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" step="1" min="0" value={p.craftPasses}
                          onChange={(e) => updNewPart(pi, { craftPasses: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" step="0.0001" value={p.unitCost}
                          onChange={(e) => updNewPart(pi, { unitCost: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" step="0.0001" value={p.laborPrice}
                          onChange={(e) => updNewPart(pi, { laborPrice: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" step="0.0001" value={p.paintCost}
                          onChange={(e) => updNewPart(pi, { paintCost: e.target.value })} />
                      </td>
                      <td className="px-1 py-1 text-center text-mint-700 font-semibold">{(num(p.unitCost) + num(p.paintCost)).toFixed(3)}</td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" step="0.0001" value={p.quotedPrice}
                          onChange={(e) => updNewPart(pi, { quotedPrice: e.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <input className={cell} type="number" step="1" placeholder="一天做多少件" value={p.dailyCapacity}
                          onChange={(e) => updNewPart(pi, { dailyCapacity: e.target.value })} />
                      </td>
                      <td className="px-1 py-1 text-center">
                        {/* 至少保留 1 行 */}
                        {newItemParts.length > 1 && (
                          <button type="button" className="text-rose text-xs"
                            onClick={() => setNewItemParts(newItemParts.filter((_, i) => i !== pi))}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="text-[#047857] text-sm mt-2 hover:underline"
                onClick={() => setNewItemParts([...newItemParts, emptyPart()])}>
                + 新增部位
              </button>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-[#f1f5f9] flex flex-row justify-end gap-2">
            <DialogClose asChild>
              <button type="button" className={btnCancel}>取消</button>
            </DialogClose>
            <button type="button" className={btnSave} disabled={itemSaving} onClick={submitAddItem}>
              {itemSaving ? "保存中..." : "💾 保存全部"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════ */}
      {/* 弹窗 B：加部位（给已有子件补单个部位）              */}
      {/* ══════════════════════════════════════════════════ */}
      <Dialog
        open={dlg.mode === "addPart"}
        onOpenChange={(open) => { if (!open) setDlg({ mode: null }); }}>
        <DialogContent className="max-w-[600px] rounded-[16px] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle className="text-[18px] font-semibold text-[#0f172a]">添加部位</DialogTitle>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <L label="部位名 *">
                <input className={inp} list="add-part-name-options" placeholder="如 头" value={newPartForm.partName}
                  onChange={(e) => setNewPartForm({ ...newPartForm, partName: e.target.value })} />
                <datalist id="add-part-name-options">
                  {uniqueNames(dlg.mode === "addPart" ? draftItems.find((it) => it.id === dlg.itemId)?.parts.map((p) => p.partName) ?? [] : []).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {partNameSuggestion(newPartForm.partName, dlg.mode === "addPart" ? draftItems.find((it) => it.id === dlg.itemId)?.parts.map((p) => p.partName) ?? [] : []) && (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-[#047857] hover:underline"
                    onClick={() => setNewPartForm({
                      ...newPartForm,
                      partName: partNameSuggestion(newPartForm.partName, dlg.mode === "addPart" ? draftItems.find((it) => it.id === dlg.itemId)?.parts.map((p) => p.partName) ?? [] : []),
                    })}
                  >
                    可能是已有部位，点击使用标准名称
                  </button>
                )}
              </L>
              <L label="工序/工艺">
                <select className={inp} value={newPartForm.craft}
                  onChange={(e) => setNewPartForm({ ...newPartForm, craft: e.target.value })}>
                  {CRAFTS.map((c2) => <option key={c2} value={c2}>{c2}</option>)}
                </select>
              </L>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <L label="核价">
                <input className={inp} type="number" step="0.0001" value={newPartForm.unitCost}
                  onChange={(e) => setNewPartForm({ ...newPartForm, unitCost: e.target.value })} />
              </L>
              <L label="人工">
                <input className={inp} type="number" step="0.0001" value={newPartForm.laborPrice}
                  onChange={(e) => setNewPartForm({ ...newPartForm, laborPrice: e.target.value })} />
              </L>
              <L label="油漆">
                <input className={inp} type="number" step="0.0001" value={newPartForm.paintCost}
                  onChange={(e) => setNewPartForm({ ...newPartForm, paintCost: e.target.value })} />
              </L>
              <L label="总核价（核价+油漆）">
                <input className={`${inp} bg-[#f9fafb] text-mint-700 font-semibold`} readOnly
                  value={(num(newPartForm.unitCost) + num(newPartForm.paintCost)).toFixed(3)} />
              </L>
              <L label="报价">
                <input className={inp} type="number" step="0.0001" value={newPartForm.quotedPrice}
                  onChange={(e) => setNewPartForm({ ...newPartForm, quotedPrice: e.target.value })} />
              </L>
              <L label="日产能（一天做多少件）">
                <input className={inp} type="number" step="1" value={newPartForm.dailyCapacity}
                  onChange={(e) => setNewPartForm({ ...newPartForm, dailyCapacity: e.target.value })} />
              </L>
              <L label="工序道数（这个部位要走几道工序，如兔子头=4）">
                <input className={inp} type="number" step="1" min="1" value={newPartForm.craftPasses}
                  onChange={(e) => setNewPartForm({ ...newPartForm, craftPasses: e.target.value })} />
              </L>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-[#f1f5f9] flex flex-row justify-end gap-2">
            <DialogClose asChild>
              <button type="button" className={btnCancel}>取消</button>
            </DialogClose>
            <button
              type="button" className={btnSave} disabled={partSaving}
              onClick={() => dlg.mode === "addPart" && submitAddPart(dlg.itemId)}>
              {partSaving ? "保存中..." : "💾 保存"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ─── 行内编辑子组件（不变）───────────────────────────────────
function PartRowView({ part: p, onEdit, onDelete }: { part: Part; onEdit: () => void; onDelete: () => void }) {
  // 点部位名或任一价格单元格 → 进入整行编辑态（去掉了独立“编辑”按钮）
  const clickable = "text-center cursor-pointer hover:bg-[#f0fdf4]";
  return (
    <tr className="border-b border-app-border" title="点任意单元格可直接编辑">
      <td className="px-2 py-2 font-medium cursor-pointer hover:bg-[#f0fdf4]" onClick={onEdit}>{p.partName}</td>
      <td className={clickable} onClick={onEdit}>{p.craft || "—"}</td>
      <td className={clickable} onClick={onEdit}>{p.craftPasses || ""}</td>
      <td className={clickable} onClick={onEdit}>{p.unitCost.toFixed(3)}</td>
      <td className={clickable} onClick={onEdit}>{p.laborPrice.toFixed(3)}</td>
      <td className={clickable} onClick={onEdit}>{p.paintCost.toFixed(3)}</td>
      <td className="text-center text-mint-700 font-semibold">{(p.unitCost + p.paintCost).toFixed(3)}</td>
      <td className={clickable} onClick={onEdit}>{p.quotedPrice.toFixed(3)}</td>
      <td className={clickable} onClick={onEdit}>{p.dailyCapacity}</td>
      <td className="text-center">
        <button className="text-rose text-xs" onClick={onDelete}>🗑️</button>
      </td>
    </tr>
  );
}

function PartRowEdit({ part, onSave, onCancel }: { part: Part; onSave: (patch: Partial<Part>) => void; onCancel: () => void }) {
  const [f, setF] = useState({ ...part });
  const n = (v: string) => (v === "" ? 0 : Number(v));
  const c = "w-full border border-app-border rounded px-1 py-1 text-center focus:outline-none focus:border-mint-400";
  const save = () => onSave({ partName: f.partName, craft: f.craft, craftPasses: f.craftPasses, unitCost: f.unitCost, laborPrice: f.laborPrice, paintCost: f.paintCost, quotedPrice: f.quotedPrice, dailyCapacity: f.dailyCapacity });
  // 回车=保存，Esc=取消（不存、恢复原值）
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    else if (e.key === "Escape") onCancel();
  };
  // 焦点离开整行（点到行外、或点别的部位行）才自动保存；在本行格子间切换不触发
  const onBlurRow = (e: React.FocusEvent<HTMLTableRowElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) save();
  };
  return (
    <tr className="bg-[#f0fdf4]" onBlur={onBlurRow}>
      <td className="px-2 py-2"><input autoFocus className="w-full border border-app-border rounded px-1 py-1" value={f.partName} onKeyDown={onKey} onChange={(e) => setF({ ...f, partName: e.target.value })} /></td>
      <td className="text-center"><select className="w-full border border-app-border rounded px-1 py-1 text-xs" value={f.craft} onKeyDown={onKey} onChange={(e) => setF({ ...f, craft: e.target.value })}><option value="">—</option>{CRAFTS.map((c2) => <option key={c2} value={c2}>{c2}</option>)}</select></td>
      <td className="text-center"><input className={c} type="number" step="1" min="0" value={f.craftPasses} onKeyDown={onKey} onChange={(e) => setF({ ...f, craftPasses: n(e.target.value) })} /></td>
      <td className="text-center"><input className={c} type="number" step="0.0001" value={f.unitCost} onKeyDown={onKey} onChange={(e) => setF({ ...f, unitCost: n(e.target.value) })} /></td>
      <td className="text-center"><input className={c} type="number" step="0.0001" value={f.laborPrice} onKeyDown={onKey} onChange={(e) => setF({ ...f, laborPrice: n(e.target.value) })} /></td>
      <td className="text-center"><input className={c} type="number" step="0.0001" value={f.paintCost} onKeyDown={onKey} onChange={(e) => setF({ ...f, paintCost: n(e.target.value) })} /></td>
      <td className="text-center text-mint-700 font-semibold">{(f.unitCost + f.paintCost).toFixed(3)}</td>
      <td className="text-center"><input className={c} type="number" step="0.0001" value={f.quotedPrice} onKeyDown={onKey} onChange={(e) => setF({ ...f, quotedPrice: n(e.target.value) })} /></td>
      <td className="text-center"><input className={c} type="number" step="1" value={f.dailyCapacity} onKeyDown={onKey} onChange={(e) => setF({ ...f, dailyCapacity: n(e.target.value) })} /></td>
      <td className="text-center text-text-tertiary text-[9px]">改完点别处自动保存</td>
    </tr>
  );
}
