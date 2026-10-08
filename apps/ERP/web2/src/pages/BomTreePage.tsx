// BOM层级树(工程部):从任一货号看上下级关联。
// 上级链=款号物料总表.MA货号 逐级向上(实单→MA模板);子孙树=实单(MA货号指向本货号)
// + 半成品设置组成(嵌套半成品递归)。BOM 节点点击跳 /bom-setup?款号=。
// 权限菜单=生产制单(与 BOM货号查询 同 gate)。
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { CaretRight, MagnifyingGlass, Prohibit } from "@phosphor-icons/react";
import { bomQueryApi } from "@/api/endpoints";
import type { BomTreeNode } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "生产制单";

const TYPE_STYLE: Record<string, string> = {
  BOM: "bg-[#e8f7ef] text-[#1a7f4b] border-[#bfe6d0]",
  半成品: "bg-[#e8f0fe] text-[#1d4ed8] border-[#c7d9fb]",
  物料: "bg-[#f1f3f6] text-[#5f6b7d] border-[#dde2e9]",
};

function NodeRow({
  node,
  depth,
  onOpenBom,
}: {
  node: BomTreeNode;
  depth: number;
  onOpenBom: (款号: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const children = node.下级 ?? [];
  return (
    <div>
      <div
        className="flex items-center gap-2 border-b border-[#eef1f5] py-1.5 pr-3 text-sm hover:bg-[#f7faf9]"
        style={{ paddingLeft: `${depth * 22 + 8}px` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={open ? "收起" : "展开"}
            className="flex h-4.5 w-4.5 shrink-0 items-center justify-center text-[#8a94a6]"
            onClick={() => setOpen(!open)}
          >
            <CaretRight
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="w-4.5 shrink-0" />
        )}
        <span
          className={`shrink-0 rounded border px-1.5 py-px text-[11px] font-semibold ${TYPE_STYLE[node.类型] ?? TYPE_STYLE.物料}`}
        >
          {node.类型}
        </span>
        {node.类型 === "BOM" && node.编号 ? (
          <button
            type="button"
            className="f-mono font-semibold text-[#1d4ed8] hover:underline"
            onClick={() => onOpenBom(node.编号!)}
          >
            {node.编号}
          </button>
        ) : (
          <span className="f-mono font-semibold text-[#1a2330]">{node.编号 ?? ""}</span>
        )}
        {node.类型 !== "BOM" && node.名称 && node.名称 !== node.编号 && (
          <span className="truncate text-[#3d4a5c]">{node.名称}</span>
        )}
        {node.类型 === "BOM" && node.名称 && (
          <span className="truncate text-[#3d4a5c]">{node.名称}</span>
        )}
        {node.副标题 && <span className="truncate text-xs text-[#8a94a6]">{node.副标题}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-[#8a94a6]">
          {node.用量 != null && <span className="f-mono">×{node.用量}</span>}
          {node.类型 === "BOM" && node.明细行数 != null && (
            <span className="f-mono">{node.明细行数} 行明细</span>
          )}
          {node.类型 === "BOM" && node.审核 != null && (
            <span
              className={`rounded px-1.5 py-px font-semibold ${
                node.审核 === "1" ? "bg-[#e8f7ef] text-[#1a7f4b]" : "bg-[#fdf3e7] text-[#b26a00]"
              }`}
            >
              {node.审核 === "1" ? "已审核" : "未审核"}
            </span>
          )}
        </span>
      </div>
      {open &&
        children.map((ch, i) => (
          <NodeRow
            key={`${ch.类型}-${ch.编号 ?? ""}-${ch.名称 ?? ""}-${i}`}
            node={ch}
            depth={depth + 1}
            onOpenBom={onOpenBom}
          />
        ))}
    </div>
  );
}

export default function BomTreePage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const sp款号 = sp.get("款号") ?? "";
  const [kwInput, setKwInput] = useState(sp款号);
  const [货号, set货号] = useState(sp款号);
  // keep-alive 页签带回新 ?款号= 时同步(URL 为准);渲染期派生,不走 effect
  const [lastSp, setLastSp] = useState(sp款号);
  if (sp款号 !== lastSp) {
    setLastSp(sp款号);
    setKwInput(sp款号);
    set货号(sp款号);
  }

  const q = useQuery({
    queryKey: ["bom-tree", 货号],
    queryFn: () => bomQueryApi.bomTree(货号),
    enabled: !permsLoading && canOpen && 货号.length > 0,
  });

  const search = () => set货号(kwInput.trim());
  const openBom = (款号: string) => navigate(`/bom-setup?款号=${encodeURIComponent(款号)}`);
  const chain = q.data?.上级链 ?? [];
  const tree = q.data?.树 ?? null;

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 BOM层级树"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">BOM层级树</h1>
        <span className="text-xs text-[#8a94a6]">
          上级=实单关联的 MA 模板;下级=挂在它下面的实单与半成品组成
        </span>
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-72 space-y-1.5">
          <label htmlFor="bt-kw" className="f-label block">
            货号
          </label>
          <input
            id="bt-kw"
            className="f-input"
            placeholder="输入货号,如 92125-MA"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
      </div>

      {!货号 ? (
        <div className="f-panel p-6">
          <DocEmpty title="输入货号后查询" description="展示该货号的 MA 上级链与下级实单/半成品组成树" />
        </div>
      ) : q.isError ? (
        <div className="f-panel p-6">
          <DocEmpty title="加载失败" description="请检查货号是否正确,或稍后重试" />
        </div>
      ) : q.isLoading ? (
        <div className="f-panel p-6 text-sm text-[#8a94a6]">加载中…</div>
      ) : (
        <>
          {chain.length > 0 && (
            <div className="f-panel flex flex-wrap items-center gap-1.5 px-5 py-3 text-sm">
              <span className="mr-1 text-xs font-semibold text-[#8a94a6]">上级链</span>
              {chain.map((r, i) => (
                <span key={`${r.款号}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && <CaretRight className="h-3.5 w-3.5 text-[#c3cad4]" />}
                  <button
                    type="button"
                    className="f-mono font-semibold text-[#1d4ed8] hover:underline"
                    title={r.款式 ?? ""}
                    onClick={() => {
                      if (!r.款号) return;
                      setKwInput(r.款号);
                      set货号(r.款号);
                    }}
                  >
                    {r.款号}
                  </button>
                </span>
              ))}
              <CaretRight className="h-3.5 w-3.5 text-[#c3cad4]" />
              <span className="f-mono font-bold text-[#1a2330]">{货号}</span>
            </div>
          )}
          <div className="f-panel min-h-0 flex-1 overflow-auto py-2">
            {tree ? (
              <NodeRow node={tree} depth={0} onOpenBom={openBom} />
            ) : (
              <DocEmpty title="暂无数据" description="该货号没有关联的 BOM 或半成品设置" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
