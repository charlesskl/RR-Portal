// 工模选择器:可搜索工模表,点行返回该工模(塑胶物料资料新增/重选工模带出工模字段)。
// 照抄老系统 web/src/pages/plastics/PlasticMoldPicker.tsx。
import { useCallback, useEffect, useState } from "react";
import { plasticMoldApi } from "@/api/endpoints";
import type { PlasticMoldRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { DocToast } from "@/components/doc/DocToast";

const PAGE_SIZE = 50;
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function PlasticMoldPicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: PlasticMoldRow) => void;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticMoldRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const r = await plasticMoldApi.list(p, PAGE_SIZE, keyword.trim());
        setRows(r.items);
        setTotal(r.total);
      } catch (e) {
        setToast({ text: errMsg(e, "加载工模表失败"), tone: "err" });
      } finally {
        setLoading(false);
      }
    },
    [keyword],
  );

  useEffect(() => {
    if (open) {
      setPage(1);
      void load(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) {
      setKeyword("");
      setPage(1);
      setRows([]);
    }
  }, [open]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PickerDialog open={open} onClose={onClose} title="选择工模" width="sm:max-w-[860px]">
      <div className="mb-3 flex gap-2">
        <input
          aria-label="搜索工模"
          className="f-input f-input-slim w-72"
          placeholder="工模编号/名称/颜色/用料"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(1);
              void load(1);
            }
          }}
        />
        <button
          type="button"
          className="f-btn h-9 px-4 text-sm"
          onClick={() => {
            setPage(1);
            void load(1);
          }}
        >
          搜索
        </button>
      </div>
      <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
        <table className="w-full text-sm" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              {["工模编号", "工模名称", "颜色", "色粉号", "用料名称", "整啤模腔数", "啤机机型"].map(
                (h) => (
                  <th key={h} className={pickerThCls}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-disabled">
                  {loading ? "加载中..." : "暂无数据"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.ID}
                  className="cursor-pointer border-b border-black/6 hover:bg-black/[0.04]"
                  onClick={() => {
                    onPick(r);
                    onClose();
                  }}
                >
                  <td className="f-mono px-3 py-2 font-semibold text-[#1d4ed8]">{r.工模编号}</td>
                  <td className="px-3 py-2">{r.工模名称 ?? ""}</td>
                  <td className="px-3 py-2">{r.颜色 ?? ""}</td>
                  <td className="px-3 py-2">{r.色粉号 ?? ""}</td>
                  <td className="px-3 py-2">{r.用料名称 ?? ""}</td>
                  <td className="f-mono px-3 py-2 text-right">{r.整啤模腔数 ?? ""}</td>
                  <td className="px-3 py-2">{r.啤机机型 ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="f-mono mt-2 flex items-center justify-between px-1 text-sm text-[#5f6b7d]">
        <span>共 {total} 条</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="f-btn h-8 px-3 text-sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
              void load(page - 1);
            }}
          >
            上一页
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="f-btn h-8 px-3 text-sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1);
              void load(page + 1);
            }}
          >
            下一页
          </button>
        </span>
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </PickerDialog>
  );
}
