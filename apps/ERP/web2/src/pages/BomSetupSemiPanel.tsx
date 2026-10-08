// BOM 物料设置页下方:该货号的「半成品设置」定义列表。
// 照抄老系统 web/src/pages/styles/SemiSetupPanel.tsx(包装类型已并入半成品,不再单列):
// 列出已设置的名称+物料组合;点「设置半成品」从当前 BOM 物料行里勾选组合保存;
// 修改=整组替换;半成品保存成功后回调父级把半成品追加进 BOM 明细。
import { useCallback, useEffect, useState } from "react";
import { MagnifyingGlass, Pencil, Plus, Trash } from "@phosphor-icons/react";
import { semiSetupApi } from "@/api/endpoints";
import type { MasterRow, SemiSetupDef, SemiSetupType } from "@/api/types";
import { buildSemiSetupLines, type SemiSetupSourceRow } from "@/lib/semiSetup";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { MaterialMasterPickDialog } from "@/components/doc/MaterialMasterPickDialog";
import { QtyInput } from "@/components/doc/QtyInput";
import { colWidthCh } from "@/lib/cellWidth";
import { CellInput } from "@/components/doc/CellInput";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocToast } from "@/components/doc/DocToast";
import { Checkbox } from "@/components/ui/checkbox";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// 展开行内组成物料小表(定义.明细)
function DefLines({ def }: { def: SemiSetupDef }) {
  return (
    <div className="rounded-lg border border-black/8 bg-black/[0.02] p-2">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {["物料编号", "物料名称", "规格", "颜色", "单位", "使用数量"].map((h) => (
              <th key={h} className="f-label px-2 py-1.5 text-left font-medium normal-case">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {def.明细.map((l) => (
            <tr key={`${l.物料编号 ?? ""}|${l.颜色 ?? ""}`} className="border-t border-black/6">
              <td className="f-mono px-2 py-1.5">{l.物料编号}</td>
              <td className="px-2 py-1.5">{l.物料名称 ?? ""}</td>
              <td className="px-2 py-1.5">{l.规格 ?? ""}</td>
              <td className="px-2 py-1.5">{l.颜色 ?? ""}</td>
              <td className="px-2 py-1.5">{l.单位 ?? ""}</td>
              <td className="f-mono px-2 py-1.5 text-right">{l.使用数量 ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ModalState {
  类型: SemiSetupType;
  名称: string;
  keys: string[];
  rows: (SemiSetupSourceRow & { key: string })[];
  saving: boolean;
  editId?: number;
  用量?: number; // 半成品用量(做 1 个成品要几个);新建默认 1,修改预填原值
}

export default function BomSetupSemiPanel({
  货号,
  物料行,
  canEdit,
  onDefsChange,
  onSemiSaved,
  onSemiUsage,
}: {
  货号: string;
  物料行: SemiSetupSourceRow[];
  canEdit: boolean;
  onDefsChange?: (defs: SemiSetupDef[]) => void; // 定义列表变化时同步给父级(BOM 明细表展开用)
  onSemiSaved?: (名称: string) => void; // 半成品保存成功后回调(父级把半成品加进 BOM 明细)
  onSemiUsage?: (名称: string, 用量: number) => void; // 定义用量改动后回调(父级同步 BOM 明细行用量)
}) {
  const [defs, setDefs] = useState<SemiSetupDef[]>([]);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null); // 弹窗内待选料的行 key
  const [deleteTarget, setDeleteTarget] = useState<SemiSetupDef | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const reload = useCallback(async () => {
    if (!货号) {
      setDefs([]);
      onDefsChange?.([]);
      return;
    }
    try {
      const list = await semiSetupApi.list(货号);
      setDefs(list);
      onDefsChange?.(list);
    } catch (e) {
      setToast({ text: errMsg(e, "载入半成品设置失败"), tone: "err" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [货号]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openModal = (类型: SemiSetupType) =>
    setModal({
      类型,
      名称: "",
      keys: [],
      saving: false,
      用量: 1,
      rows: 物料行.length
        ? 物料行.map((r, i) => ({ ...r, key: `src-${i}` }))
        : [{ key: "new-0", 物料编号: "" }],
    });

  // 修改已有定义:名称+明细预填进弹窗(明细行全勾选),保存走 update 整组替换
  const openEdit = (d: SemiSetupDef) =>
    setModal({
      类型: d.类型,
      名称: d.名称,
      keys: d.明细.map((_, i) => `edit-${i}`),
      rows: d.明细.map((l, i) => ({
        key: `edit-${i}`,
        物料编号: l.物料编号,
        物料名称: l.物料名称 ?? undefined,
        规格: l.规格 ?? undefined,
        颜色: l.颜色 ?? undefined,
        单位: l.单位 ?? undefined,
        用量: l.使用数量 ?? undefined,
      })),
      saving: false,
      editId: d.ID,
      用量: d.用量 ?? 1,
    });

  const patchRow = (key: string, p: Partial<ModalState["rows"][number]>) =>
    setModal((m) =>
      m && { ...m, rows: m.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) },
    );

  // 从物料资料选料回填该行;选料即勾选(未勾选的行保存时被丢弃,别让选中的料静默丢掉)
  const pickMaterial = (m: MasterRow) => {
    const key = pickFor;
    if (key == null) return;
    setModal(
      (md) =>
        md && {
          ...md,
          rows: md.rows.map((r) =>
            r.key === key
              ? {
                  ...r,
                  物料编号: String(m.物料编号 ?? ""),
                  物料名称: String(m.物料名称 ?? ""),
                  规格: String(m.规格 ?? ""),
                  颜色: String(m.颜色 ?? ""),
                  单位: String(m.单位 ?? ""),
                }
              : r,
          ),
          keys: md.keys.includes(key) ? md.keys : [...md.keys, key],
        },
    );
    setPickFor(null);
  };

  const doSave = async () => {
    if (!modal) return;
    const 名称 = modal.名称.trim();
    if (!名称) {
      setToast({ text: "请填写名称", tone: "err" });
      return;
    }
    const 明细 = buildSemiSetupLines(modal.rows, modal.keys);
    if (明细.length === 0) {
      setToast({ text: "请至少勾选 1 行物料", tone: "err" });
      return;
    }
    setModal({ ...modal, saving: true });
    try {
      if (modal.editId != null) {
        await semiSetupApi.update(modal.editId, {
          货号,
          名称,
          类型: modal.类型,
          用量: modal.用量 ?? 1,
          明细,
        });
        setToast({ text: `${modal.类型}「${名称}」已保存修改`, tone: "ok" });
      } else {
        await semiSetupApi.create({ 货号, 名称, 类型: modal.类型, 用量: modal.用量 ?? 1, 明细 });
        setToast({ text: `${modal.类型}「${名称}」已保存`, tone: "ok" });
        if (modal.类型 === "半成品") onSemiSaved?.(名称);
      }
      setModal(null);
      await reload();
    } catch (e) {
      setToast({ text: errMsg(e, "保存失败"), tone: "err" });
      setModal({ ...modal, saving: false });
    }
  };

  const doRemove = async (d: SemiSetupDef) => {
    try {
      await semiSetupApi.remove(d.ID);
      setToast({ text: `已删除「${d.名称}」`, tone: "ok" });
      await reload();
    } catch (e) {
      setToast({ text: errMsg(e, "删除失败"), tone: "err" });
    }
  };

  // 行内改「半成品用量」(做 1 个成品要几个该半成品;与定义明细的物料使用数量是两个层级):
  // 失焦即保存(整组定义原样随包),并同步父级 BOM 明细里的同名半成品行
  const saveUsage = async (d: SemiSetupDef, v: number | undefined) => {
    if (v == null || v <= 0) {
      if (v != null) setToast({ text: "用量必须大于 0", tone: "err" });
      return;
    }
    if (v === (d.用量 ?? 1)) return;
    try {
      await semiSetupApi.update(d.ID, {
        货号: d.货号,
        名称: d.名称,
        类型: d.类型,
        用量: v,
        明细: d.明细,
      });
      setToast({ text: `「${d.名称}」用量已改为 ${v}`, tone: "ok" });
      onSemiUsage?.(d.名称, v);
      await reload();
    } catch (e) {
      setToast({ text: errMsg(e, "保存用量失败"), tone: "err" });
    }
  };

  const renderCard = (类型: SemiSetupType) => {
    const list = defs.filter((d) => d.类型 === 类型);
    return (
      <div className="f-panel">
        <div className="flex items-center justify-between border-b border-black/8 px-5 py-3">
          <span className="text-[15px] font-semibold text-[#1a2330]">{类型}设置</span>
          <button
            type="button"
            className="f-btn f-btn-cyan h-9 px-3 text-sm"
            disabled={!canEdit}
            onClick={() => openModal(类型)}
          >
            <Plus className="h-4 w-4" />
            设置{类型}
          </button>
        </div>
        <div className="space-y-2 p-4">
          {list.length === 0 ? (
            <span className="text-sm text-disabled">暂无</span>
          ) : (
            list.map((d) => (
              <div key={d.ID} className="rounded-lg border border-black/8">
                <div className="flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    className="text-left text-[15px] font-medium text-[#1d4ed8] hover:underline"
                    onClick={() =>
                      setExpanded((xs) =>
                        xs.includes(d.ID) ? xs.filter((x) => x !== d.ID) : [...xs, d.ID],
                      )
                    }
                  >
                    {d.名称}
                  </button>
                  <span className="f-label">物料数 {d.明细.length}</span>
                  <span className="text-xs text-disabled">
                    {d.操作员 ?? ""} {(d.创建时间 ?? "").replace("T", " ").slice(0, 19)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {/* 半成品用量:做 1 个成品要几个该半成品(与定义明细的物料用量分开) */}
                    <span className="flex items-center gap-1 text-xs text-[#5f6b7d]">
                      用量
                      <QtyInput
                        ariaLabel={`半成品用量 ${d.名称}`}
                        value={d.用量 ?? 1}
                        disabled={!canEdit}
                        className="f-input f-input-slim h-8 text-right"
                        style={{ width: "4.5rem" }}
                        onChange={(v) => void saveUsage(d, v)}
                      />
                    </span>
                    {canEdit && (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`修改${类型} ${d.名称}`}
                          className="rounded-md p-1.5 text-[#3d4a5c] hover:bg-black/6"
                          onClick={() => openEdit(d)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除${类型} ${d.名称}`}
                          className="rounded-md p-1.5 text-[#dc2626] hover:bg-black/6"
                          onClick={() => setDeleteTarget(d)}
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </span>
                </div>
                {expanded.includes(d.ID) && <div className="px-3 pb-3"><DefLines def={d} /></div>}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // 弹窗明细列统一宽度(规则同 BOM 网格):该列最长内容 +3 余量,封顶 CELL_CAP_CH,超长点击显示
  const semiColCh = {
    物料编号: colWidthCh((modal?.rows ?? []).map((r) => r.物料编号)),
    物料名称: colWidthCh((modal?.rows ?? []).map((r) => r.物料名称 ?? "")),
    规格: colWidthCh((modal?.rows ?? []).map((r) => r.规格 ?? "")),
    颜色: colWidthCh((modal?.rows ?? []).map((r) => r.颜色 ?? "")),
    单位: colWidthCh((modal?.rows ?? []).map((r) => r.单位 ?? "")),
  };

  return (
    <div className="space-y-4">
      {renderCard("半成品")}

      <PickerDialog
        open={modal !== null}
        onClose={() => modal?.saving || setModal(null)}
        title={modal ? `${modal.editId != null ? "修改" : "设置"}${modal.类型} · ${货号}` : ""}
        width="sm:max-w-[860px]"
        footer={
          <>
            <button
              type="button"
              className="f-btn h-10 px-4"
              onClick={() => setModal(null)}
              disabled={modal?.saving}
            >
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={!modal?.名称.trim() || modal.keys.length === 0 || modal.saving}
              onClick={() => void doSave()}
            >
              确定
            </button>
          </>
        }
      >
        {modal && (
          <div className="space-y-3">
            <input
              className="f-input f-input-slim"
              placeholder={`${modal.类型}名称(必填)`}
              value={modal.名称}
              maxLength={100}
              onChange={(e) => setModal({ ...modal, 名称: e.target.value })}
            />
            <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={pickerThCls} style={{ width: 40 }}></th>
                    {["物料编号", "物料名称", "规格", "颜色", "单位", "用量"].map((h) => (
                      <th key={h} className={pickerThCls}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modal.rows.map((r, rowIdx) => (
                    <tr key={r.key} className="border-b border-black/6">
                      <td className="px-3 py-1.5">
                        <Checkbox
                          aria-label={`勾选 ${r.物料编号 || r.key}`}
                          className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                          checked={modal.keys.includes(r.key)}
                          onCheckedChange={(v) =>
                            setModal((m) =>
                              m && {
                                ...m,
                                keys:
                                  v === true
                                    ? [...m.keys, r.key]
                                    : m.keys.filter((k) => k !== r.key),
                              },
                            )
                          }
                        />
                      </td>
                      {(["物料编号", "物料名称", "规格", "颜色", "单位"] as const).map((f) => (
                        <td key={f} className="px-2 py-1">
                          {f === "物料编号" ? (
                            <div className="flex items-center gap-1">
                              <div className="min-w-0 flex-1">
                                <CellInput
                                  ariaLabel={`行${rowIdx + 1} ${f}`}
                                  value={String(r[f] ?? "")}
                                  widthCh={semiColCh[f]}
                                  onChange={(v) => patchRow(r.key, { [f]: v })}
                                />
                              </div>
                              <button
                                type="button"
                                aria-label={`行${rowIdx + 1} 选物料`}
                                title="从物料资料搜索选择"
                                className="shrink-0 rounded-md p-1.5 text-[#5f6b7d] hover:bg-black/6"
                                onClick={() => setPickFor(r.key)}
                              >
                                <MagnifyingGlass className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <CellInput
                              ariaLabel={`行${rowIdx + 1} ${f}`}
                              value={String(r[f] ?? "")}
                              widthCh={semiColCh[f]}
                              onChange={(v) => patchRow(r.key, { [f]: v })}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <QtyInput
                          ariaLabel={`行${rowIdx + 1} 用量`}
                          value={r.用量}
                          onChange={(v) => patchRow(r.key, { 用量: v })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="f-btn h-9 px-3 text-sm"
                onClick={() =>
                  setModal((m) =>
                    m && {
                      ...m,
                      rows: [...m.rows, { key: `new-${Date.now()}`, 物料编号: "" }],
                    },
                  )
                }
              >
                <Plus className="h-4 w-4" />
                加一行
              </button>
              <span className="text-sm text-[#5f6b7d]">
                可直接在表里填写/修改物料(不影响上面的 BOM 表);已选 {modal.keys.length} / 共{" "}
                {modal.rows.length} 行
              </span>
            </div>
          </div>
        )}
      </PickerDialog>

      <ConfirmDialog
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `删除${deleteTarget.类型}「${deleteTarget.名称}」?` : ""}
        onConfirm={() => {
          const t = deleteTarget;
          setDeleteTarget(null);
          if (t) void doRemove(t);
        }}
      />

      {/* 行内放大镜:从物料资料搜料回填该行(嵌套在设置弹窗之上);只显示该货号(含共用)物料 */}
      <MaterialMasterPickDialog
        open={pickFor !== null}
        onPick={pickMaterial}
        onClose={() => setPickFor(null)}
        货号={货号}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
