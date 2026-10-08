// 物料类别左树面板(物料资料/塑胶物料资料两页共用;树组装纯函数在 @/lib/categoryTree,
// 照抄老系统 web/src/pages/materials/MaterialMasterPage.tsx)。
// 顶部「新增同级类别/新增子类别」按钮:类别主数据由页面回调落库。
import { useMemo, useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  ALL_CAT_KEY,
  buildCategoryTree,
  type CatInfo,
  type CategoryNodeLike,
} from "@/lib/categoryTree";
import { PickerDialog } from "@/components/doc/PickerDialog";

export function CategoryTreePanel({
  cats,
  allLabel,
  selKey,
  onSelect,
  canEditCat,
  onCreateCat,
}: {
  cats: CategoryNodeLike[];
  allLabel: string; // 全部物料 / 全部塑胶物料
  selKey: string;
  onSelect: (key: string) => void;
  canEditCat: boolean;
  // parent: null=顶级;字符串=父类别编号/名称(与后端 类别 列口径一致,照抄老系统)
  onCreateCat: (name: string, parent: string | null) => Promise<boolean>;
}) {
  const { roots, childrenOf, infoByKey } = useMemo(() => buildCategoryTree(cats), [cats]);
  const sel = selKey === ALL_CAT_KEY ? undefined : infoByKey.get(selKey);

  const [catDlg, setCatDlg] = useState<{ parent: string | null } | null>(null);
  const [catName, setCatName] = useState("");
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [allCollapsed, setAllCollapsed] = useState(false);

  const submitCat = async () => {
    const name = catName.trim();
    if (!name || !catDlg) return;
    setSaving(true);
    try {
      const ok = await onCreateCat(name, catDlg.parent);
      if (ok) setCatDlg(null);
    } finally {
      setSaving(false);
    }
  };

  const renderNode = (info: CatInfo, depth: number) => {
    const kids = childrenOf.get(info.key) ?? [];
    const isCollapsed = collapsed.includes(info.key);
    return (
      <div key={info.key}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
            selKey === info.key
              ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
              : "text-[#3d4a5c] hover:bg-black/[0.04]",
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => onSelect(info.key)}
        >
          {kids.length > 0 ? (
            <span
              role="button"
              aria-label={`${isCollapsed ? "展开" : "收起"} ${info.name}`}
              className="shrink-0 text-[#5f6b7d]"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((cs) =>
                  cs.includes(info.key) ? cs.filter((c) => c !== info.key) : [...cs, info.key],
                );
              }}
            >
               {isCollapsed ? (
                <CaretRight className="h-3.5 w-3.5" />
              ) : (
                <CaretDown className="h-3.5 w-3.5" />
              )}
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {info.name}({info.count})
        </button>
        {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="w-60 shrink-0 border-r border-black/8 pr-3">
      {canEditCat && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className="f-btn h-8 px-2.5 text-xs"
            disabled={!sel}
            onClick={() => {
              setCatName("");
              setCatDlg({ parent: sel?.parent ?? null });
            }}
          >
            新增同级类别
          </button>
          <button
            type="button"
            className="f-btn h-8 px-2.5 text-xs"
            onClick={() => {
              setCatName("");
              setCatDlg({ parent: sel ? (sel.code ?? sel.name) : null });
            }}
          >
            新增子类别
          </button>
        </div>
      )}
      {/* 「全部物料」作为整树根节点(对齐老系统 antd Tree):箭头收起/展开全部类别,点行选中全部 */}
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
          selKey === ALL_CAT_KEY
            ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
            : "text-[#3d4a5c] hover:bg-black/[0.04]",
        )}
        onClick={() => onSelect(ALL_CAT_KEY)}
      >
        <span
          role="button"
          aria-label={allCollapsed ? "展开全部类别" : "收起全部类别"}
          className="shrink-0 text-[#5f6b7d]"
          onClick={(e) => {
            e.stopPropagation();
            setAllCollapsed((v) => !v);
          }}
        >
          {allCollapsed ? (
            <CaretRight className="h-3.5 w-3.5" />
          ) : (
            <CaretDown className="h-3.5 w-3.5" />
          )}
        </span>
        {allLabel}
      </button>
      {!allCollapsed && roots.map((r) => renderNode(r, 1))}

      <PickerDialog
        open={catDlg !== null}
        onClose={() => setCatDlg(null)}
        title={catDlg?.parent ? `新增子类别(上级:${catDlg.parent})` : "新增类别(顶级)"}
        width="sm:max-w-[420px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setCatDlg(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={!catName.trim() || saving}
              onClick={() => void submitCat()}
            >
              确定
            </button>
          </>
        }
      >
        <input
          aria-label="类别名称"
          className="f-input f-input-slim"
          placeholder="类别名称"
          value={catName}
          maxLength={20}
          onChange={(e) => setCatName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submitCat()}
        />
      </PickerDialog>
    </div>
  );
}
