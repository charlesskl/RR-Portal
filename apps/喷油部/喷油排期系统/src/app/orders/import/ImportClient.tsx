"use client";
import { apiFetch } from "@/lib/apiFetch";
// PDF 订单导入 · 核对界面（客户端）
// 流程：上传 PDF → 调 /api/orders/import-pdf 出草稿 → 文员核对(绿/红行手工选) → 确认入库。
// 货号产品库找不到 → 走「待补产品」（只登记订单头）。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DraftHead = { externalOrderNo: string; orderDate: string; deliveryDate: string | null; productNo: string; isMa: boolean };
type DraftLine = { pdfItemName: string; totalQty: number; mergedRows: number; matchedItemName: string | null };
type Draft = {
  head: DraftHead; productFound: boolean; productId: number | null;
  lines: DraftLine[]; pdfToken: string; availableItems: string[];
};

const SKIP = "__skip__";

export default function ImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [head, setHead] = useState<DraftHead | null>(null);
  const [fileName, setFileName] = useState("");
  // 红行的人工处理：行下标 → 选中的产品库子件名，或 SKIP（跳过本行）
  const [picks, setPicks] = useState<Record<number, string>>({});

  async function doUpload() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr("请先选择 PDF 文件"); return; }
    setBusy(true); setErr("");
    const fd = new FormData(); fd.append("file", f);
    try {
      const res = await apiFetch("/api/orders/import-pdf", { method: "POST", body: fd });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "解析失败，请确认是委托加工合同 PDF"); return; }
      const d: Draft = await res.json();
      setDraft(d); setHead(d.head); setPicks({}); setFileName(f.name);
    } catch { setErr("网络错误，请确认后端服务是否运行后重试"); }
    finally { setBusy(false); }
  }

  // 某行最终确定的产品库子件名：绿行=其匹配名；红行=人工选的名（SKIP/未选返回 null）
  function resolved(i: number, ln: DraftLine): string | null {
    if (ln.matchedItemName) return ln.matchedItemName;
    const p = picks[i];
    return !p || p === SKIP ? null : p;
  }
  // 还有红行没处理（既没选子件也没标跳过）→ 不能入库
  const redPending = !!draft?.productFound && draft.lines.some((ln, i) => !ln.matchedItemName && !picks[i]);
  const redCount = draft?.lines.filter((ln) => !ln.matchedItemName).length ?? 0;

  async function doConfirm(asPending: boolean) {
    if (!draft || !head) return;
    setBusy(true); setErr("");
    const lines = asPending ? [] : draft.lines
      .map((ln, i) => ({ name: resolved(i, ln), totalQty: ln.totalQty }))
      .filter((x) => x.name)   // 跳过未匹配/已标跳过的红行
      .map((x) => ({ matchedItemName: x.name as string, totalQty: x.totalQty }));
    const body = { head, pdfToken: draft.pdfToken, asPendingProduct: asPending, lines };
    try {
      const res = await apiFetch("/api/orders/import-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "入库失败，请重试"); return; }
      alert(asPending ? "已登记订单（待补产品），可在订单总览「待补产品」标签补全。" : "导入成功！");
      router.push("/orders"); router.refresh();
    } catch { setErr("网络错误，请确认后端服务是否运行后重试"); }
    finally { setBusy(false); }
  }

  // ── 阶段一：上传 ──
  if (!draft || !head) {
    return (
      <Card title="📥 PDF 订单导入" sub="上传委托加工合同 PDF，系统解析后供核对，确认无误再入库">
        <div className="border-2 border-dashed border-[#d6e3dd] rounded-card bg-[#fbfdfc] p-10 text-center">
          <div className="text-4xl">📄</div>
          <p className="text-text-secondary text-sm my-3">选择委托加工合同 PDF（要求一张合同一个货号）</p>
          <input ref={fileRef} type="file" accept=".pdf" className="block mx-auto text-sm" />
          {err && <p className="text-rose text-sm mt-3">{err}</p>}
          <div className="flex justify-center gap-3 mt-5">
            <Link href="/orders" className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">取消</Link>
            <button disabled={busy} onClick={doUpload}
              className="bg-[#fbbf24] hover:brightness-105 text-white px-5 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(251,191,36,0.30)] disabled:opacity-50">
              {busy ? "解析中…" : "＋ 解析 PDF"}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  // ── 阶段二：核对 ──
  return (
    <Card title="📥 PDF 订单导入 · 核对" sub={`已解析：${fileName}`}>
      {/* 状态横幅 */}
      {draft.productFound ? (
        <div className="bg-mint-50 border-l-[3px] border-mint-400 text-[#065f46] rounded-btn px-4 py-3 text-sm mb-4">
          ✅ 货号 <b>{head.productNo}</b> 已匹配产品库 · 共 <b>{draft.lines.length}</b> 个子件
          {redCount > 0 ? <span className="text-rose font-semibold"> · {redCount} 个待处理</span>
            : <span className="text-mint-700 font-semibold"> · 全部已匹配</span>}
        </div>
      ) : (
        <div className="bg-[#fef2f2] border-l-[3px] border-[#f87171] text-[#991b1b] rounded-btn px-4 py-3 text-sm mb-4">
          ⚠️ 货号 <b>{head.productNo || "（未识别）"}</b> 未在产品库中找到。本单只登记订单头并标记「待补产品」，
          PDF 已保存，产品建好后可在订单总览「待补产品」标签一键补全。
        </div>
      )}

      {/* 订单信息（可改） */}
      <div className="text-[15px] font-semibold text-text border-l-4 border-mint-400 pl-3 mb-3">订单信息</div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Fld label="外部订单号">
          <input value={head.externalOrderNo} onChange={(e) => setHead({ ...head, externalOrderNo: e.target.value })} className={inp + " font-mono"} />
        </Fld>
        <Fld label="下单日期">
          <input type="date" value={head.orderDate} onChange={(e) => setHead({ ...head, orderDate: e.target.value })} className={inp} />
        </Fld>
        <Fld label="交货日期">
          <input type="date" value={head.deliveryDate ?? ""} onChange={(e) => setHead({ ...head, deliveryDate: e.target.value || null })} className={inp} />
        </Fld>
        <Fld label="款号 / MA">
          <div className="h-[38px] flex items-center gap-2">
            <span className="font-mono text-sm">{head.productNo || "—"}</span>
            <label className="text-xs text-text-secondary flex items-center gap-1">
              <input type="checkbox" checked={head.isMa} onChange={(e) => setHead({ ...head, isMa: e.target.checked })} /> MA
            </label>
          </div>
        </Fld>
      </div>

      {/* 子件明细（仅产品库命中时） */}
      {draft.productFound && (
        <>
          <div className="text-[15px] font-semibold text-text border-l-4 border-mint-400 pl-3 mb-3">子件明细</div>
          <table className="w-full text-sm">
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
              <tr>
                <th className="px-3 py-2.5 text-left w-[34%]">PDF 子件名</th>
                <th className="px-3 py-2.5 text-left w-[42%]">产品库匹配</th>
                <th className="px-3 py-2.5 text-right">合计数量</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((ln, i) => {
                const isRed = !ln.matchedItemName;
                const skipped = picks[i] === SKIP;
                return (
                  <tr key={i} className={isRed && !picks[i] ? "bg-[#fef2f2]" : i % 2 ? "bg-[#fafdfb]" : ""}>
                    <td className="px-3 py-2.5">
                      <span className={skipped ? "line-through text-text-tertiary" : ""}>{ln.pdfItemName}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {!isRed ? (
                        <span className="text-mint-700 font-medium inline-flex items-center gap-1.5"><span className="text-mint-400">✓</span>{ln.matchedItemName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          {!picks[i] && <span className="text-[11px] bg-[#fee2e2] text-rose px-2 py-0.5 rounded-full font-semibold">未找到</span>}
                          <select value={picks[i] ?? ""} onChange={(e) => setPicks({ ...picks, [i]: e.target.value })}
                            className="h-[34px] border border-[#fca5a5] rounded-btn px-2 text-[12.5px] text-rose bg-white min-w-[190px]">
                            <option value="">选择对应子件…</option>
                            {draft.availableItems.map((a) => <option key={a} value={a}>{a}</option>)}
                            <option value={SKIP}>✗ 跳过本行（不导入）</option>
                          </select>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-mono font-semibold text-text">{ln.totalQty.toLocaleString("zh-CN")}</span>
                      {ln.mergedRows > 1 && <span className="ml-2 text-[11px] text-text-tertiary bg-[#f1f5f9] px-1.5 py-0.5 rounded">{ln.mergedRows} 行合并</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {err && <p className="text-rose text-sm mt-4">{err}</p>}

      {/* 底部操作 */}
      <div className="flex items-center gap-3 mt-6 pt-5 border-t border-app-border-light">
        <div className="text-[12.5px] text-text-tertiary">
          {draft.productFound
            ? (redPending ? <>还有 <b className="text-rose">{draft.lines.filter((ln, i) => !ln.matchedItemName && !picks[i]).length}</b> 个子件没处理，处理完才能入库</> : "可入库")
            : "新货号 · 仅登记订单头"}
        </div>
        <div className="ml-auto flex gap-3">
          <button onClick={() => { setDraft(null); setHead(null); setErr(""); }} className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">重新上传</button>
          {draft.productFound ? (
            <button disabled={busy || redPending} onClick={() => doConfirm(false)}
              className="bg-mint-400 hover:bg-mint-700 text-white px-5 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)] disabled:bg-[#cbd5e1] disabled:shadow-none">
              {busy ? "入库中…" : "确认入库"}
            </button>
          ) : (
            <button disabled={busy} onClick={() => doConfirm(true)}
              className="bg-mint-400 hover:bg-mint-700 text-white px-5 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)] disabled:opacity-50">
              {busy ? "登记中…" : "登记订单（待补产品）"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

const inp = "h-[38px] w-full border border-app-border rounded-btn px-3 text-[13.5px] bg-white focus:outline-none focus:border-mint-400";

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">{title}</h1>
      {sub && <p className="text-xs text-text-tertiary mt-1 mb-4">{sub}</p>}
      {children}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><label className="text-xs text-text-secondary font-medium">{label}</label>{children}</div>;
}
