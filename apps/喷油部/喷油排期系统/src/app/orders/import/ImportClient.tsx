"use client";
// PDF 订单导入 · 核对界面（客户端）
// 流程：上传 PDF → 调 /api/orders/import-pdf 出草稿 → 文员核对(绿/红行手工选) → 确认入库。
// 货号产品库找不到 → 走「待补产品」（只登记订单头）。
import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";

type DraftHead = { externalOrderNo: string; orderDate: string; deliveryDate: string | null; productNo: string; isMa: boolean };
type DraftLine = { pdfItemName: string; totalQty: number; mergedRows: number; matchedItemName: string | null; unitPrice: number; existingUnitCost: number | null };
type Draft = {
  head: DraftHead; productFound: boolean; productId: number | null;
  lines: DraftLine[]; pdfToken: string; availableItems: string[];
  products?: { productNo: string; isMa: boolean; productFound: boolean; lines: DraftLine[]; availableItems: string[] }[];
};

const SKIP = "__skip__";

export default function ImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [head, setHead] = useState<DraftHead | null>(null);
  const [fileName, setFileName] = useState("");
  // 红行的人工处理：行下标 → 选中的产品库子件名，或 SKIP（跳过本行）
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [newNames, setNewNames] = useState<Record<number, string>>({});
  const [multiPicks, setMultiPicks] = useState<Record<string, string>>({});
  const [multiNames, setMultiNames] = useState<Record<string, string>>({});
  const [savePricing, setSavePricing] = useState(false);

  function chooseFile(file: File | null) {
    setErr("");
    if (!file) { setSelectedFile(null); return; }
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) {
      setSelectedFile(null); setErr("仅支持 PDF、PNG、JPG 图片"); return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setSelectedFile(null); setErr("文件不能超过 15 MB"); return;
    }
    setSelectedFile(file);
  }

  function onDropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    chooseFile(event.dataTransfer.files[0] ?? null);
  }

  async function doUpload() {
    const f = selectedFile;
    if (!f) { setErr("请先选择或拖入 PDF、PNG、JPG 文件"); return; }
    setBusy(true); setErr("");
    const fd = new FormData(); fd.append("file", f);
    try {
      const res = await apiFetch("/api/orders/import-pdf", { method: "POST", body: fd });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "解析失败，请确认是委托加工合同 PDF"); return; }
      const d: Draft = await res.json();
      setDraft(d); setHead(d.head); setPicks({}); setNewNames({}); setMultiPicks({}); setMultiNames({});
      setSavePricing(d.products?.some(product => !product.productFound) ?? !d.productFound);
      setFileName(f.name);
    } catch { setErr("网络错误，请确认后端服务是否运行后重试"); }
    finally { setBusy(false); }
  }

  // 某行最终确定的产品库子件名：绿行=其匹配名；红行=人工选的名（SKIP/未选返回 null）
  function resolved(i: number, ln: DraftLine): string | null {
    if (draft && !draft.productFound) return (newNames[i] ?? ln.matchedItemName ?? ln.pdfItemName).trim() || null;
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
      .map((ln, i) => ({ name: resolved(i, ln), totalQty: ln.totalQty, unitPrice: ln.unitPrice }))
      .filter((x) => x.name)   // 跳过未匹配/已标跳过的红行
      .map((x) => ({ matchedItemName: x.name as string, totalQty: x.totalQty, unitPrice: x.unitPrice }));
    const body = { head, pdfToken: draft.pdfToken, asPendingProduct: asPending, savePricing, lines };
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

  async function doConfirmMulti() {
    if (!draft?.products || !head) return;
    if (!head.externalOrderNo.trim() || !head.orderDate) { setErr("请核对订单编号和下单日期"); return; }
    const products = draft.products.map((product, productIndex) => ({
      productNo: product.productNo, isMa: product.isMa,
      lines: product.lines.map((line, lineIndex) => ({
        matchedItemName: product.productFound
          ? (line.matchedItemName || multiPicks[`${productIndex}-${lineIndex}`] || "")
          : (multiNames[`${productIndex}-${lineIndex}`] ?? line.matchedItemName ?? ""),
        totalQty: line.totalQty, unitPrice: line.unitPrice,
      })).filter(line => line.matchedItemName && line.matchedItemName !== SKIP),
    }));
    if (products.some(product => product.lines.length === 0)) { setErr("每个款号至少保留一条部件明细"); return; }
    setBusy(true); setErr("");
    try {
      const res = await apiFetch("/api/orders/import-confirm-multi", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ head, pdfToken: draft.pdfToken, savePricing, products }),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error ?? "导入失败"); return; }
      router.push("/orders"); router.refresh();
    } catch { setErr("网络错误，请稍后重试"); }
    finally { setBusy(false); }
  }

  // ── 阶段一：上传 ──
  if (!draft || !head) {
    return (
      <Card title="📥 订单导入" sub="上传委托加工合同 PDF 或图片，系统解析后供核对，确认无误再入库">
        <div
          onDragEnter={event => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={event => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
          onDrop={onDropFile}
          className={`border-2 border-dashed rounded-card p-10 text-center transition-colors ${dragging ? "border-mint-400 bg-mint-50" : "border-[#d6e3dd] bg-[#fbfdfc]"}`}
        >
          <div className="text-4xl">📄</div>
          <p className="text-text-secondary text-sm my-3">将 PDF 或清晰图片拖到这里，或选择文件；识别后请逐项核对</p>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="block mx-auto text-sm" onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
          {selectedFile && <p className="mt-3 text-sm text-mint-700">已选择：{selectedFile.name}</p>}
          {err && <p className="text-rose text-sm mt-3">{err}</p>}
          <div className="flex justify-center gap-3 mt-5">
            <Link href="/orders" className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">取消</Link>
            <button disabled={busy || !selectedFile} onClick={doUpload}
              className="bg-[#fbbf24] hover:brightness-105 text-white px-5 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(251,191,36,0.30)] disabled:opacity-50">
              {busy ? "解析中…" : "＋ 开始解析"}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (draft.products && draft.products.length > 1) {
    const hasUnknown = draft.products.some(product => !product.productFound);
    const hasUnmatched = draft.products.some((product, pi) => product.lines.some((line, li) =>
      product.productFound ? (!line.matchedItemName && !multiPicks[`${pi}-${li}`])
        : !(multiNames[`${pi}-${li}`] ?? line.matchedItemName ?? "").trim()));
    return <Card title="📥 多款号订单导入 · 核对" sub={`同一合同号 ${head.externalOrderNo} · ${draft.products.length} 个款号`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Fld label="订单编号"><input className={inp} value={head.externalOrderNo} onChange={e => setHead({ ...head, externalOrderNo: e.target.value })} /></Fld>
        <Fld label="下单日期"><input className={inp} type="date" value={head.orderDate} onChange={e => setHead({ ...head, orderDate: e.target.value })} /></Fld>
        <Fld label="交货日期"><input className={inp} type="date" value={head.deliveryDate ?? ""} onChange={e => setHead({ ...head, deliveryDate: e.target.value || null })} /></Fld>
      </div>
      {draft.products.map((product, pi) => <div key={product.productNo} className="border border-app-border rounded-btn mb-4 overflow-hidden">
        <div className="bg-[#f0fdf4] px-4 py-3 font-semibold">款号 {product.productNo}{product.isMa ? " · MA" : ""}
          {!product.productFound && <span className="ml-3 text-rose text-sm">产品库无此款号，将建立草稿核价</span>}</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-text-secondary"><th className="px-3 py-2">PDF 部件</th><th className="px-3 py-2">产品库匹配</th><th className="px-3 py-2 text-right">数量</th><th className="px-3 py-2 text-right">单价</th></tr></thead>
          <tbody>{product.lines.map((line, li) => <tr key={li} className="border-t border-app-border-light"><td className="px-3 py-2">{line.pdfItemName}</td>
            <td className="px-3 py-2">{!product.productFound ? <input className={inp} aria-label={`${product.productNo} 部件名`} value={multiNames[`${pi}-${li}`] ?? line.matchedItemName ?? ""} onChange={e => setMultiNames(current => ({ ...current, [`${pi}-${li}`]: e.target.value }))} /> : line.matchedItemName ?? <select className={inp} value={multiPicks[`${pi}-${li}`] ?? ""} onChange={e => setMultiPicks(current => ({ ...current, [`${pi}-${li}`]: e.target.value }))}>
              <option value="">选择对应部件…</option>{product.availableItems.map(item => <option key={item} value={item}>{item}</option>)}<option value={SKIP}>跳过本行</option>
            </select>}</td><td className="px-3 py-2 text-right">{line.totalQty.toLocaleString("zh-CN")}</td><td className="px-3 py-2 text-right">{line.unitPrice.toFixed(4)}</td></tr>)}</tbody></table>
      </div>)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={savePricing} disabled={hasUnknown} onChange={e => setSavePricing(e.target.checked)} />{hasUnknown ? "建立缺失款号的草稿核价" : "把订单单价更新到产品核价库"}</label>
      {err && <p className="text-rose text-sm mt-3">{err}</p>}
      <div className="flex justify-end gap-3 mt-5"><button className="border border-app-border rounded-btn px-4 py-2 text-sm" onClick={() => { setDraft(null); setErr(""); }}>重新上传</button>
        <button className="bg-mint-400 text-white rounded-btn px-5 py-2 text-sm disabled:opacity-50" disabled={busy || hasUnmatched || !head.externalOrderNo || !head.orderDate || (hasUnknown && !savePricing)} onClick={doConfirmMulti}>{busy ? "保存中…" : "确认导入一张订单"}</button></div>
    </Card>;
  }

  // ── 阶段二：核对 ──
  return (
    <Card title="📥 PDF 订单导入 · 核对" sub={`已解析：${fileName}`}>
      {/* 状态横幅 */}
      {draft.productFound ? (
        <div className="bg-mint-50 border-l-[3px] border-mint-400 text-[#065f46] rounded-btn px-4 py-3 text-sm mb-4">
          ✅ 货号 <b>{head.productNo}</b> 已匹配核价库 · 共 <b>{draft.lines.length}</b> 个部件
          {redCount > 0 ? <span className="text-rose font-semibold"> · {redCount} 个待处理</span>
            : <span className="text-mint-700 font-semibold"> · 全部已匹配</span>}
        </div>
      ) : (
        <div className="bg-[#fef2f2] border-l-[3px] border-[#f87171] text-[#991b1b] rounded-btn px-4 py-3 text-sm mb-4">
          ⚠️ 货号 <b>{head.productNo || "（未识别）"}</b> 未在核价库中找到。请核对下方订单部位和单价，确认后可直接创建草稿核价并登记订单。
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

      {/* 部件明细（仅核价库命中时） */}
      {(
        <>
          <div className="text-[15px] font-semibold text-text border-l-4 border-mint-400 pl-3 mb-3">部件明细</div>
          <table className="w-full text-sm">
            <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
              <tr>
                <th className="px-3 py-2.5 text-left w-[34%]">订单部件名</th>
                <th className="px-3 py-2.5 text-left w-[42%]">产品库匹配</th>
                <th className="px-3 py-2.5 text-right">合计数量</th>
                <th className="px-3 py-2.5 text-right">订单核价</th>
                <th className="px-3 py-2.5 text-right">库内核价</th>
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
                      {!draft.productFound ? <input className={inp} aria-label={`部件 ${i + 1} 名称`} value={newNames[i] ?? ln.matchedItemName ?? ln.pdfItemName} onChange={e => setNewNames(current => ({ ...current, [i]: e.target.value }))} /> : !isRed ? (
                        <span className="text-mint-700 font-medium inline-flex items-center gap-1.5"><span className="text-mint-400">✓</span>{ln.matchedItemName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          {!picks[i] && <span className="text-[11px] bg-[#fee2e2] text-rose px-2 py-0.5 rounded-full font-semibold">未找到</span>}
                          <select value={picks[i] ?? ""} onChange={(e) => setPicks({ ...picks, [i]: e.target.value })}
                            className="h-[34px] border border-[#fca5a5] rounded-btn px-2 text-[12.5px] text-rose bg-white min-w-[190px]">
                            <option value="">选择对应部件…</option>
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
                    <td className="px-3 py-2.5 text-right font-mono">{ln.unitPrice.toFixed(4)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{ln.existingUnitCost == null ? "—" : ln.existingUnitCost.toFixed(4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {err && <p className="text-rose text-sm mt-4">{err}</p>}

      <label className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={savePricing} onChange={(e) => setSavePricing(e.target.checked)} />
        {draft.productFound ? "将订单单价更新到核价库（不勾选则只登记订单）" : "同时创建草稿核价（新货号必选）"}
      </label>

      {/* 底部操作 */}
      <div className="flex items-center gap-3 mt-6 pt-5 border-t border-app-border-light">
        <div className="text-[12.5px] text-text-tertiary">
          {draft.productFound
            ? (redPending ? <>还有 <b className="text-rose">{draft.lines.filter((ln, i) => !ln.matchedItemName && !picks[i]).length}</b> 个部件没处理，处理完才能入库</> : "可入库")
            : "新货号 · 可从订单直接建立核价"}
        </div>
        <div className="ml-auto flex gap-3">
          <button onClick={() => { setDraft(null); setHead(null); setErr(""); }} className="text-sm border border-app-border rounded-btn px-4 py-2 text-text-secondary">重新上传</button>
          {draft.productFound ? (
            <button disabled={busy || redPending} onClick={() => doConfirm(false)}
              className="bg-mint-400 hover:bg-mint-700 text-white px-5 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)] disabled:bg-[#cbd5e1] disabled:shadow-none">
              {busy ? "入库中…" : "确认入库"}
            </button>
          ) : (
            <button disabled={busy || !savePricing || draft.lines.length === 0} onClick={() => doConfirm(false)}
              className="bg-mint-400 hover:bg-mint-700 text-white px-5 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)] disabled:opacity-50">
              {busy ? "保存中…" : "保存核价并登记订单"}
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
