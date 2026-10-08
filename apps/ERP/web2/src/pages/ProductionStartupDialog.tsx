// 生产单「一键启动」面板(Batch 0D 移植;照抄老系统 web/src/pages/production/ProductionStartupModal.tsx):
// 审核后点一下,自动算料(BOM展开应领) + 查库存(来料仓+塑胶仓合并) + 算缺口,
// 一眼看到"这批货要多少料、现在有多少、还差多少、下一步点哪个"。
// 数据全部走现有只读接口,前端聚合,零后端改动。
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { PaperPlaneRight, ShoppingCart } from "@phosphor-icons/react";
import { inventoryApi, plasticInventoryApi, productionApi } from "@/api/endpoints";
import type { IssueBasisRow } from "@/api/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StartupRow extends IssueBasisRow {
  库存: number;
  缺口: number;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

// 并行取:BOM展开应领明细(不带档=全部) + 来料库存 + 塑胶库存,按物料编号合并两仓库存算缺口
async function loadStartup(生产单号: string): Promise<StartupRow[]> {
  const [basis, matInv, plasticInv] = await Promise.all([
    productionApi.issueBasis(生产单号),
    inventoryApi.list({}).catch(() => []),
    plasticInventoryApi.list().catch(() => []),
  ]);
  const stock: Record<string, number> = {};
  for (const s of [...matInv, ...plasticInv]) {
    if (s.物料编号) stock[s.物料编号] = (stock[s.物料编号] ?? 0) + Number(s.库存数量 ?? 0);
  }
  return (basis ?? []).map((b) => {
    const 应领 = Number(b.数量 ?? 0);
    const 库存 = stock[b.物料编号 ?? ""] ?? 0;
    return { ...b, 库存, 缺口: Math.max(0, 应领 - 库存) };
  });
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div>
      <div className="f-label">{label}</div>
      <div
        className={`f-mono mt-1 text-2xl font-bold ${
          alert ? "text-[#dc2626]" : "text-[#15803d]"
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

export default function ProductionStartupDialog({
  open,
  生产单号,
  onClose,
}: {
  open: boolean;
  生产单号: string;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["production-startup", 生产单号],
    queryFn: () => loadStartup(生产单号),
    enabled: open && !!生产单号,
  });
  const rows = q.data ?? [];
  const loading = q.isLoading;

  const 缺口种数 = rows.filter((r) => r.缺口 > 0).length;
  const 总应领 = rows.reduce((s, r) => s + Number(r.数量 ?? 0), 0);
  const 总缺口 = rows.reduce((s, r) => s + r.缺口, 0);

  const go = (path: string) => {
    onClose();
    nav(path);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>生产启动 · {生产单号}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-10">
          <Stat label="物料种类" value={rows.length} />
          <Stat label="应领总量" value={总应领} />
          <Stat label="缺口种类" value={缺口种数} alert={缺口种数 > 0} />
          <Stat label="缺口总量" value={总缺口} alert={总缺口 > 0} />
        </div>

        {q.isError && (
          <p className="mt-3 text-sm text-[#dc2626]">
            加载算料结果失败:{errMsg(q.error)}
            <button type="button" className="ml-2 underline" onClick={() => q.refetch()}>
              重试
            </button>
          </p>
        )}

        <div className="f-panel mt-4 max-h-[46vh] overflow-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-black/8 bg-black/[0.03]">
                {["物料编号", "物料名称", "规格", "单位"].map((h) => (
                  <th
                    key={h}
                    className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-2.5 text-left font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
                {["应领量", "当前库存", "缺口"].map((h) => (
                  <th
                    key={h}
                    className="f-label sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-2.5 text-right font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-disabled">
                    算料中...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-disabled">
                    该生产单没有应领物料
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.物料编号 ?? ""}-${i}`} className="border-b border-black/6 last:border-0">
                    <td className="f-mono px-4 py-2 text-[#3d4a5c]">{r.物料编号}</td>
                    <td className="px-4 py-2 text-[#3d4a5c]">{r.物料名称}</td>
                    <td className="px-4 py-2 text-[#3d4a5c]">{r.规格 ?? "-"}</td>
                    <td className="px-4 py-2 text-[#3d4a5c]">{r.单位}</td>
                    <td className="f-mono px-4 py-2 text-right text-[#1a2330]">
                      {Number(r.数量 ?? 0).toLocaleString()}
                    </td>
                    <td className="f-mono px-4 py-2 text-right">
                      <span className={r.库存 < 0 ? "text-[#dc2626]" : "text-[#3d4a5c]"}>
                        {r.库存.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.缺口 > 0 ? (
                        <span className="inline-flex rounded-full border border-[#dc2626]/40 bg-[#dc2626]/8 px-2.5 py-0.5 text-xs font-semibold text-[#dc2626]">
                          缺 {r.缺口.toLocaleString()}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-[#16a34a]/40 bg-[#16a34a]/8 px-2.5 py-0.5 text-xs font-semibold text-[#15803d]">
                          够
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-[#5f6b7d]">
          缺口 = 应领量 - 当前库存;负库存表示已超发,需先补料。点「下推领料」按应领量生成领料单。
        </p>

        <DialogFooter>
          <button type="button" className="f-btn h-10 px-4" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="f-btn h-10 px-4"
            onClick={() => go("/purchase-material-analysis")}
          >
            <ShoppingCart className="h-4 w-4" />
            去采购分析(补缺口)
          </button>
          <button
            type="button"
            className="f-btn h-10 px-4"
            onClick={() => go(`/material-issues?basis=${encodeURIComponent(生产单号)}`)}
          >
            <PaperPlaneRight className="h-4 w-4" />
            下推领料·来料仓
          </button>
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-4"
            onClick={() => go(`/plastic-issues?basis=${encodeURIComponent(生产单号)}`)}
          >
            <PaperPlaneRight className="h-4 w-4" />
            下推领料·塑胶仓
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
