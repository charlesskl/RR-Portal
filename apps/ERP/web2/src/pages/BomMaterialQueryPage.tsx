// BOM物料查询(工程部;老系统 web/src/pages/production/BomMaterialQueryPage.tsx 重写):
// 关键字(款号/物料编号/物料名称) + 明细表;点款号跳 BOM物料设置;
// 点物料名称:半成品行弹「半成品组成」(取半成品设置明细,实单版 BOM 回落关联 MA 货号),
// 其余行弹「产品资料查询A · 物料资料」只读查看。
// 权限菜单=生产制单(MenuCatalog 实证:业务单据组)。
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { MagnifyingGlass, Prohibit } from "@phosphor-icons/react";
import { bomQueryApi, masterDataApi, semiSetupApi, stylesApi } from "@/api/endpoints";
import type { BomMaterialRow, MasterRow, SemiSetupDef, SemiSetupLine } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";

const MENU = "生产制单";
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

const col = createColumnHelper<BomMaterialRow>();

export default function BomMaterialQueryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const q = useQuery({
    queryKey: ["bom-material-query", keyword],
    queryFn: () => bomQueryApi.bomMaterials(keyword || undefined),
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  // 物料资料查看弹窗(产品资料查询A,只读)
  const [lookOpen, setLookOpen] = useState(false);
  const [lookKw, setLookKw] = useState("");
  const [lookRows, setLookRows] = useState<MasterRow[]>([]);
  const [lookLoading, setLookLoading] = useState(false);

  // 半成品组成查看弹窗(取「半成品设置」的明细)
  const [semiOpen, setSemiOpen] = useState(false);
  const [semiTitle, setSemiTitle] = useState("");
  const [semiRows, setSemiRows] = useState<SemiSetupLine[]>([]);
  const [semiLoading, setSemiLoading] = useState(false);

  const loadLookup = async (kw: string) => {
    setLookLoading(true);
    try {
      const r = await masterDataApi("materials").list(1, 50, kw);
      setLookRows(r.items ?? []);
    } catch (e) {
      setToast({ text: errMsg(e, "加载物料资料失败"), tone: "err" });
    } finally {
      setLookLoading(false);
    }
  };

  const openLookup = (物料编号?: string, 物料名称?: string) => {
    const kw = (物料编号 || 物料名称 || "").trim();
    setLookKw(kw);
    setLookOpen(true);
    void loadLookup(kw);
  };

  const openSemi = async (款号: string | undefined, 物料类别: string | undefined, 名称: string) => {
    if (!款号) return;
    setSemiTitle(`${名称}(${物料类别})`);
    setSemiRows([]);
    setSemiOpen(true);
    setSemiLoading(true);
    const findDef = (defs: SemiSetupDef[]) =>
      defs.find((d) => d.名称 === 名称 && d.类型 === 物料类别) ??
      defs.find((d) => d.名称 === 名称);
    try {
      let def = findDef(await semiSetupApi.list(款号));
      if (!def) {
        // 实单版 BOM:半成品定义挂在关联 MA 货号下
        const ma货号 = (await stylesApi.materials(款号)).单头?.MA货号;
        if (ma货号) def = findDef(await semiSetupApi.list(ma货号));
      }
      if (!def) {
        setToast({ text: `未找到「${名称}」的${物料类别}设置`, tone: "err" });
        setSemiOpen(false);
        return;
      }
      setSemiRows(def.明细 ?? []);
    } catch (e) {
      setToast({ text: errMsg(e, "加载半成品组成失败"), tone: "err" });
      setSemiOpen(false);
    } finally {
      setSemiLoading(false);
    }
  };

  const go = (款号?: string) => {
    if (款号) navigate(`/bom-setup?款号=${encodeURIComponent(款号)}`);
  };

  const columns = useMemo(
    () => [
      col.accessor("款号", {
        header: "款号",
        size: 130,
        cell: (c) => (
          <button
            type="button"
            className="f-mono font-semibold text-[#1d4ed8] hover:underline"
            onClick={() => go(c.getValue())}
          >
            {c.getValue()}
          </button>
        ),
      }),
      col.accessor("款式", { header: "款式", size: 150, cell: (c) => c.getValue() ?? "" }),
      col.accessor("物料编号", {
        header: "物料编号",
        size: 130,
        cell: (c) => <span className="f-mono">{c.getValue() ?? ""}</span>,
      }),
      col.accessor("物料名称", {
        header: "物料名称",
        size: 220,
        cell: (c) => {
          const r = c.row.original;
          const v = c.getValue() ?? "";
          const isSemi = r.物料类别 === "半成品";
          return (
            <button
              type="button"
              className="text-left text-[#1d4ed8] hover:underline"
              onClick={() =>
                isSemi ? void openSemi(r.款号, r.物料类别, v) : openLookup(r.物料编号, v)
              }
            >
              {v}
            </button>
          );
        },
      }),
      col.accessor("物料类别", { header: "物料类别", size: 110, cell: (c) => c.getValue() ?? "" }),
      col.accessor("规格", { header: "规格", size: 130, cell: (c) => c.getValue() ?? "" }),
      col.accessor("颜色", { header: "颜色", size: 100, cell: (c) => c.getValue() ?? "" }),
      col.accessor("单位", { header: "单位", size: 80, cell: (c) => c.getValue() ?? "" }),
      col.accessor("使用数量", {
        header: "使用数量",
        size: 110,
        meta: { align: "right" },
        cell: (c) => <span className="f-mono block text-right">{c.getValue() ?? ""}</span>,
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 BOM物料查询"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">BOM物料查询</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-72 space-y-1.5">
          <label htmlFor="bmq-kw" className="f-label block">
            关键字
          </label>
          <input
            id="bmq-kw"
            className="f-input"
            placeholder="款号 / 物料编号 / 物料名称"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setKeyword(kwInput.trim())}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => q.refetch()}
        errorMessage="加载 BOM物料查询 失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前关键字下没有 BOM 物料行"
        fill
        minWidth={1080}
        defaultTdClass="truncate px-4 text-[#3d4a5c]"
        footer={<span>共 {rows.length} 条</span>}
      />

      {/* 产品资料查询A · 物料资料(只读) */}
      <PickerDialog
        open={lookOpen}
        onClose={() => setLookOpen(false)}
        title="产品资料查询A · 物料资料"
        width="sm:max-w-[900px]"
      >
        <div className="mb-3 flex gap-2">
          <input
            aria-label="搜索物料资料"
            className="f-input f-input-slim w-72"
            placeholder="物料编号 / 物料名称"
            defaultValue={lookKw}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadLookup((e.target as HTMLInputElement).value);
            }}
          />
          <button
            type="button"
            className="f-btn h-9 px-4 text-sm"
            onClick={(e) => {
              const input = (e.currentTarget.previousSibling as HTMLInputElement);
              void loadLookup(input.value);
            }}
          >
            搜索
          </button>
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                {["物料编号", "物料名称", "规格", "材料", "颜色", "单位", "备注"].map((h) => (
                  <th key={h} className={pickerThCls}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lookRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-disabled">
                    {lookLoading ? "加载中..." : "暂无数据"}
                  </td>
                </tr>
              ) : (
                lookRows.map((r, i) => (
                  <tr key={r.ID ?? r.id ?? i} className="border-b border-black/6">
                    <td className="f-mono px-3 py-2">{String(r.物料编号 ?? "")}</td>
                    <td className="px-3 py-2">{String(r.物料名称 ?? "")}</td>
                    <td className="px-3 py-2">{String(r.规格 ?? "")}</td>
                    <td className="px-3 py-2">{String(r.物料类别 ?? "")}</td>
                    <td className="px-3 py-2">{String(r.颜色 ?? "")}</td>
                    <td className="px-3 py-2">{String(r.单位 ?? "")}</td>
                    <td className="px-3 py-2">{String(r.备注 ?? "")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PickerDialog>

      {/* 半成品组成 */}
      <PickerDialog
        open={semiOpen}
        onClose={() => setSemiOpen(false)}
        title={`半成品组成 · ${semiTitle}`}
        width="sm:max-w-[760px]"
      >
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                {["物料编号", "物料名称", "规格", "颜色", "单位", "使用数量"].map((h) => (
                  <th key={h} className={pickerThCls}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {semiRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-disabled">
                    {semiLoading ? "加载中..." : "暂无组成明细"}
                  </td>
                </tr>
              ) : (
                semiRows.map((l) => (
                  <tr key={`${l.物料编号}|${l.规格 ?? ""}`} className="border-b border-black/6">
                    <td className="f-mono px-3 py-2">{l.物料编号}</td>
                    <td className="px-3 py-2">{l.物料名称 ?? ""}</td>
                    <td className="px-3 py-2">{l.规格 ?? ""}</td>
                    <td className="px-3 py-2">{l.颜色 ?? ""}</td>
                    <td className="px-3 py-2">{l.单位 ?? ""}</td>
                    <td className="f-mono px-3 py-2 text-right">{l.使用数量 ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PickerDialog>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
