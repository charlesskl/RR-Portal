// 委托加工单(原装配加工采购单) 两个明细网格(生产明细/明细表),编辑态 + 只读态。
// 新流程:生产明细行直接「选半成品/选物料」入行(货号/名称可改),生产单号 带生产通知单选择器;
// 明细表(物料)手工维护+「选物料」入行,编号/名称/单个产品需求量/需求数(g/个) 均可改,
// 与生产明细的半成品一起下在同一张委托加工单。
// 网格样式对齐 BOM物料设置页:f-panel p-4 面板 + 圆角边框滚动容器 + CellInput 瘦身输入框
// + 行首「插入/删」链接 + 面板底部「添加行」按钮。
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { txt } from "@/lib/format";
import { CellInput } from "@/components/doc/CellInput";
import type { AccessoryEditLine, ProductionEditLine } from "@/lib/assemblyPurchase";

const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

const money = (v?: number | null) => Number(v ?? 0).toFixed(2);

// 选择弹窗内仍用盒式输入框(AssemblyPurchasePage 引入);网格内已统一 CellInput
export const gridInputCls =
  "h-9 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

// 网格面板:BOM物料设置同款(f-panel p-4 + 面板内操作行 + 圆角边框滚动容器 + 底部添加行)
function GridPanel({
  minWidth,
  hint,
  actions,
  footer,
  children,
}: {
  minWidth: string;
  hint?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="f-panel p-4">
      {(actions || hint) && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {actions}
          {hint && <span className="ml-auto text-sm text-[#5f6b7d]">{hint}</span>}
        </div>
      )}
      <div className="max-h-[52vh] overflow-auto rounded-lg border border-black/8">
        <table data-freeze className={cn("w-full text-sm", minWidth)}>{children}</table>
      </div>
      {footer}
    </div>
  );
}

// 三个网格共用的面板头 props
type PanelHead = { hint?: string; actions?: React.ReactNode };

// 行首「插入/删」链接(BOM 物料明细同款)
function RowOps({ onInsert, onRemove }: { onInsert: () => void; onRemove: () => void }) {
  return (
    <td className="px-1.5 py-1.5 whitespace-nowrap">
      <button type="button" className="px-1 text-[#1d4ed8] hover:underline" onClick={onInsert}>
        插入
      </button>
      <button type="button" className="px-1 text-[#dc2626] hover:underline" onClick={onRemove}>
        删
      </button>
    </td>
  );
}

// 行首操作列表头(88px,与 BOM 一致)
const opsTh = <th className={thCls} style={{ width: 88 }} />;

// 面板底部「添加行」按钮(BOM 同款)
function AddRowBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="f-btn mt-3 h-9 px-4 text-sm" onClick={onClick}>
      <Plus className="h-4 w-4" />
      添加行
    </button>
  );
}

// ---------- 生产明细(编辑态):货号/名称可改;生产单号由行头「绑生产单」统一带入,行内不再逐个选 ----------

export function ProductionEditor({
  rows,
  onPatch,
  onRemove,
  onInsert,
  onAdd,
  hint,
  actions,
}: {
  rows: ProductionEditLine[];
  onPatch: (key: number, patch: Partial<ProductionEditLine>) => void;
  onRemove: (key: number) => void;
  onInsert: (idx: number) => void;
  onAdd: () => void;
} & PanelHead) {
  return (
    <GridPanel
      minWidth="min-w-[1350px]"
      hint={hint}
      actions={actions}
      footer={<AddRowBtn onClick={onAdd} />}
    >
      <thead>
        <tr className="border-b border-black/8">
          {opsTh}
          {["序号", "接单日期", "生产单号", "产品货号", "产品名称", "配件编号", "产品装配名称", "加工数量", "单价", "金额"].map(
            (h) => (
              <th
                key={h}
                className={cn(
                  thCls,
                  (h === "加工数量" || h === "单价" || h === "金额") && "text-right",
                )}
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={r.key} className="border-b border-black/6 last:border-0 hover:bg-black/[0.02]">
            <RowOps onInsert={() => onInsert(idx)} onRemove={() => onRemove(r.key)} />
            <td className="f-mono px-3 py-1.5 text-disabled">{idx + 1}</td>
            <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">{r.接单日期 ?? ""}</td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`行${idx + 1} 生产单号`}
                widthCh={16}
                value={r.生产单号 ?? ""}
                onChange={(v) => onPatch(r.key, { 生产单号: v })}
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`行${idx + 1} 产品货号`}
                placeholder="选物料/半成品或手录"
                widthCh={16}
                value={r.产品货号 ?? ""}
                onChange={(v) => onPatch(r.key, { 产品货号: v || undefined })}
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`行${idx + 1} 产品名称`}
                widthCh={18}
                value={r.产品名称 ?? ""}
                onChange={(v) => onPatch(r.key, { 产品名称: v || undefined })}
              />
            </td>
            <td className="px-3 py-1.5 text-[#3d4a5c]">{r.配件编号 ?? ""}</td>
            <td className="px-3 py-1.5 text-[#3d4a5c]">{r.产品装配名称 ?? ""}</td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`行${idx + 1} 生产明细加工数量`}
                widthCh={10}
                value={r.加工数量 == null ? "" : String(r.加工数量)}
                onChange={(v) =>
                  onPatch(r.key, { 加工数量: v.trim() === "" ? null : Number(v) })
                }
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`行${idx + 1} 生产明细单价`}
                widthCh={10}
                value={r.单价 == null ? "" : String(r.单价)}
                onChange={(v) =>
                  onPatch(r.key, { 单价: v.trim() === "" ? null : Number(v) })
                }
              />
            </td>
            <td className="f-mono px-3 py-1.5 text-right whitespace-nowrap text-[#3d4a5c]">
              {r.生产单号 || r.产品货号 ? money(r.金额) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </GridPanel>
  );
}

// ---------- 明细表(编辑态):物料 编号/名称/需求量/需求数(g/个) 均可改 ----------

export function AccessoriesEditor({
  rows,
  onPatch,
  onInsert,
  onRemove,
  onAdd,
  hint,
  actions,
}: {
  rows: AccessoryEditLine[];
  onPatch: (key: number, patch: Partial<AccessoryEditLine>) => void;
  onInsert: (idx: number) => void;
  onRemove: (key: number) => void;
  onAdd: () => void;
} & PanelHead) {
  return (
    <GridPanel
      minWidth="min-w-[1100px]"
      hint={hint}
      actions={actions}
      footer={<AddRowBtn onClick={onAdd} />}
    >
      <thead>
        <tr className="border-b border-black/8">
          {opsTh}
          {["序号", "产品货号", "物料编号", "物料名称", "加工总数量", "单个产品需求量", "需求数(g)", "需求数(个)"].map(
            (h) => (
              <th
                key={h}
                className={cn(
                  thCls,
                  (h === "加工总数量" || h === "单个产品需求量" || h === "需求数(g)" || h === "需求数(个)") &&
                    "text-right",
                )}
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={r.key} className="border-b border-black/6 last:border-0 hover:bg-black/[0.02]">
            <RowOps onInsert={() => onInsert(idx)} onRemove={() => onRemove(r.key)} />
            <td className="px-3 py-1.5 text-disabled">{r.序号}</td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`明细${r.序号} 产品货号`}
                widthCh={14}
                value={r.产品货号 ?? ""}
                onChange={(v) => onPatch(r.key, { 产品货号: v || undefined })}
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`明细${r.序号} 物料编号`}
                widthCh={14}
                value={r.辅料编号 ?? ""}
                onChange={(v) => onPatch(r.key, { 辅料编号: v || undefined })}
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`明细${r.序号} 物料名称`}
                widthCh={18}
                value={r.辅料名称 ?? ""}
                onChange={(v) => onPatch(r.key, { 辅料名称: v || undefined })}
              />
            </td>
            <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{r.加工总数量 ?? ""}</td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`明细${r.序号} 单个产品需求量`}
                widthCh={10}
                value={r.单个产品需求量 == null ? "" : String(r.单个产品需求量)}
                onChange={(v) =>
                  onPatch(r.key, { 单个产品需求量: v.trim() === "" ? null : Number(v) })
                }
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`明细${r.序号} 需求数(g)`}
                widthCh={10}
                value={r.需求数克 == null ? "" : String(r.需求数克)}
                onChange={(v) =>
                  onPatch(r.key, { 需求数克: v.trim() === "" ? null : Number(v) })
                }
              />
            </td>
            <td className="px-3 py-1.5">
              <CellInput
                ariaLabel={`明细${r.序号} 需求数(个)`}
                widthCh={10}
                value={r.需求数个 == null ? "" : String(r.需求数个)}
                onChange={(v) =>
                  onPatch(r.key, { 需求数个: v.trim() === "" ? null : Number(v) })
                }
              />
            </td>
          </tr>
        ))}
      </tbody>
    </GridPanel>
  );
}

// ---------- 只读态(已审核) ----------

const roThCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3 text-left font-medium whitespace-nowrap normal-case";
const roTd = "px-4 py-2 text-[#3d4a5c]";
const roNum = "f-mono px-4 py-2 text-right text-[#3d4a5c]";

export function ProductionView({ rows }: { rows: ProductionEditLine[] }) {
  return (
    <GridPanel minWidth="min-w-[1150px]">
      <thead>
        <tr className="border-b border-black/8">
          {["序号", "接单日期", "生产单号", "产品货号", "产品名称", "配件编号", "产品装配名称", "加工数量", "单价", "金额"].map(
            (h) => (
              <th
                key={h}
                className={cn(roThCls, (h === "加工数量" || h === "单价" || h === "金额") && "text-right")}
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} className="h-11 border-b border-black/6 last:border-0">
            <td className="f-mono px-4 py-2 text-disabled">{i + 1}</td>
            <td className="f-mono px-4 py-2 whitespace-nowrap text-[#3d4a5c]">{txt(r.接单日期)}</td>
            <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">{txt(r.生产单号)}</td>
            <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(r.产品货号)}</td>
            <td className={roTd}>{txt(r.产品名称)}</td>
            <td className={roTd}>{txt(r.配件编号)}</td>
            <td className={roTd}>{txt(r.产品装配名称)}</td>
            <td className={roNum}>{r.加工数量 ?? ""}</td>
            <td className={roNum}>{r.单价 ?? ""}</td>
            <td className={roNum}>{r.生产单号 || r.产品货号 ? money(r.金额) : ""}</td>
          </tr>
        ))}
      </tbody>
    </GridPanel>
  );
}

export function AccessoriesView({ rows }: { rows: AccessoryEditLine[] }) {
  return (
    <GridPanel minWidth="min-w-[1000px]">
      <thead>
        <tr className="border-b border-black/8">
          {["序号", "产品货号", "物料编号", "物料名称", "加工总数量", "单个产品需求量", "需求数(g)", "需求数(个)"].map(
            (h) => (
              <th
                key={h}
                className={cn(
                  roThCls,
                  (h === "加工总数量" || h === "单个产品需求量" || h === "需求数(g)" || h === "需求数(个)") &&
                    "text-right",
                )}
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="h-11 border-b border-black/6 last:border-0">
            <td className="px-4 py-2 text-disabled">{r.序号}</td>
            <td className="f-mono px-4 py-2 text-[#3d4a5c]">{txt(r.产品货号)}</td>
            <td className="f-mono px-4 py-2 whitespace-nowrap text-[#1a2330]">{txt(r.辅料编号)}</td>
            <td className={roTd}>{txt(r.辅料名称)}</td>
            <td className={roNum}>{r.加工总数量 ?? ""}</td>
            <td className={roNum}>{r.单个产品需求量 ?? ""}</td>
            <td className={roNum}>{r.需求数克 ?? ""}</td>
            <td className={roNum}>{r.需求数个 ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </GridPanel>
  );
}
