// 塑胶采购订单·系统内打印预览页(/plastic-purchase-order-print?doc=X,标签页打开,不再弹外部窗口)。
// 模板口径与单据页「打印」一致:按次数/工序区分——啤机单(一次加工未选工序)→ 啤机部生产啤货表;
// 选了工序的加工单(喷油/印喷/电镀等,无论第几次加工)→ 委托加工合同;
// 预览用 iframe srcDoc 渲染(打印 CSS 与正文隔离),「打印」按钮直接调浏览器打印(默认连本机打印机)。
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Printer, Prohibit } from "@phosphor-icons/react";
import { plasticPurchaseOrderApi } from "@/api/endpoints";
import {
  buildMoldingSheetHtml,
  buildPlasticContractPrintHtml,
  display加工类型,
} from "@/lib/plasticPurchase";
import { usePerms } from "@/hooks/usePerms";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";

const MENU = "塑胶采购订单";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

export default function PlasticPurchaseOrderPrintPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [sp] = useSearchParams();
  // 参数名 doc(不用 单号:各单据页 keep-alive 挂载,会把 ?单号= 当自己的参数消费清掉);
  // 首读即固化到 state,后续 URL 变化不影响本页
  const [单号] = useState(() => sp.get("doc") ?? "");
  const [html, setHtml] = useState("");
  const [title, setTitle] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!canOpen || !单号) return;
    let live = true;
    void plasticPurchaseOrderApi
      .get(单号)
      .then((d) => {
        if (!live) return;
        // 按次数/工序裁决:啤机单(一次加工未选工序)→ 啤货表;选了工序 → 委托加工合同
        const 啤机单 = display加工类型(d.单头?.加工类型, d.单头?.加工内容) === "啤机";
        setHtml(啤机单 ? buildMoldingSheetHtml(d) : buildPlasticContractPrintHtml(d));
        setTitle(啤机单 ? "啤机部生产啤货表" : "委托加工合同");
      })
      .catch((e) => setToast({ text: errMsg(e) || "加载单据失败", tone: "err" }));
    return () => {
      live = false;
    };
  }, [canOpen, 单号]);

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty icon={<Prohibit className="h-5 w-5" />} title="无权访问该页面" />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto flex h-full max-w-[1500px] flex-col gap-3 p-5">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          {title || "打印预览"}
          {单号 && <span className="f-mono ml-2 text-lg font-semibold text-[#15803d]">{单号}</span>}
        </h1>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          disabled={!html}
          onClick={() => iframeRef.current?.contentWindow?.print()}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        <span className="text-sm text-[#5f6b7d]">
          版式已内置 A4 横向;点「打印」调起浏览器打印(可选本机已连接的打印机/另存 PDF)
        </span>
      </div>
      {!单号 ? (
        <div className="f-panel p-6">
          <DocEmpty title="缺少 doc 参数(从塑胶采购订单点「打印」进入)" />
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title="打印预览"
          aria-label="打印预览"
          className="min-h-0 w-full flex-1 rounded-[14px] border border-black/8 bg-white"
          srcDoc={html}
        />
      )}
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
