// 排期行 -> 生产通知单弹窗:按排期行预填(货号/数量/客户/走货期),复用 productionApi.create(同生产通知单页)。
// 行为照抄老系统 web/src/pages/scheduling/ScheduleProductionModal.tsx:
//  a) 货号已建 BOM(bom-headers 命中)且无绑定冲突 -> 直接带入预填;
//  b) 未建 BOM -> 「去建 BOM」跳 /bom-setup(带 款号/品名/客户名称/po/return 参数;Batch 1 已注册该页);
//  c) BOM 已绑「排期行 PO 之外」的 PO -> 弹确认(列出已绑定 PO 号),「继续使用」= 与当前 PO 双绑后才带入;
//     「取消」= 停留本窗口不带入(bomRejected)。
// 绑定确认文案/行为与 Task 3 生产通知单页(ProductionPage)对齐。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FilePlus, WarningCircle } from "@phosphor-icons/react";
import { productionApi, stylesApi } from "@/api/endpoints";
import type { BomHeaderOption } from "@/api/types";
import { MENU_PATHS } from "@/nav/menu";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocToast } from "@/components/doc/DocToast";

export interface ScheduleProductionCtx {
  货号: string;
  品名?: string;
  数量?: number;
  排期客户?: string;
  客户名称?: string;
  PO号?: string;
  客PO?: string;
  SKU?: string;
  走货期?: string;
  接单日期?: string;
  总箱数?: number;
  // 排期行 MA 规则字段:去建 BOM 时随 URL 带入(实单→BOM 页自动切实单版+预选关联MA)
  单类型?: string;
  关联MA货号?: string;
}

interface ProdForm {
  数量: string;
  客户编号: string;
  客户名称: string;
  交货日期: string;
  下单日期: string;
  订单总箱数: string;
  备注: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const date10 = (v?: string) => (v ? v.slice(0, 10) : "");

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// 「去建 BOM」目标 URL(老系统 /bom-setup 带参格式,po 参数照抄);web2 未注册该路由时不跳
// 单类型/关联MA货号:实单跳入时 BOM 页自动切实单版 + 预选关联 MA(与排期行徽标跳转同口径)
function bomSetupUrl(ctx: ScheduleProductionCtx): string {
  const base =
    `/bom-setup?款号=${encodeURIComponent(ctx.货号)}` +
    `&品名=${encodeURIComponent(ctx.品名 ?? "")}` +
    `&客户名称=${encodeURIComponent(ctx.排期客户 ?? ctx.客户名称 ?? "")}` +
    `&return=${encodeURIComponent("/scheduling")}` +
    (ctx.单类型 ? `&单类型=${encodeURIComponent(ctx.单类型)}` : "") +
    (ctx.关联MA货号 ? `&关联MA货号=${encodeURIComponent(ctx.关联MA货号)}` : "");
  return ctx.PO号 ? `${base}&po=${encodeURIComponent(ctx.PO号)}` : base;
}

export default function ScheduleProductionDialog({
  ctx,
  onClose,
}: {
  ctx: ScheduleProductionCtx | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<ProdForm>({
    数量: "", 客户编号: "", 客户名称: "", 交货日期: "", 下单日期: today(), 订单总箱数: "", 备注: "",
  });
  const [bom, setBom] = useState<BomHeaderOption | null>(null);
  const [checking, setChecking] = useState(false);
  const [noBom, setNoBom] = useState(false);
  // BOM 已绑定别的 PO 且用户点「取消」:停留本窗口,不带入该 BOM
  const [bomRejected, setBomRejected] = useState(false);
  const [bindConfirm, setBindConfirm] = useState<{
    hit: BomHeaderOption;
    款号: string;
    po: string;
    others: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const patch = (p: Partial<ProdForm>) => setForm((f) => ({ ...f, ...p }));

  // 带入 BOM 并按排期行预填(照抄老系统 setFieldsValue)
  const applyBom = (hit: BomHeaderOption) => {
    if (!ctx) return;
    setBom(hit);
    setForm({
      数量: ctx.数量 != null ? String(ctx.数量) : "",
      客户编号: hit.客户编号 ?? "",
      客户名称: hit.客户名称 ?? ctx.客户名称 ?? "",
      交货日期: date10(ctx.走货期),
      下单日期: date10(ctx.接单日期) || today(),
      订单总箱数: ctx.总箱数 != null ? String(Math.round(ctx.总箱数)) : "",
      备注: `排期下单:${ctx.排期客户 ?? ""}${ctx.PO号 ? ` PO=${ctx.PO号}` : ""}${ctx.客PO ? ` 客PO=${ctx.客PO}` : ""} 货号=${ctx.货号}`,
    });
  };

  // 打开时:查该货号是否已建 BOM,有才允许生成;BOM 已绑其他 PO 时先弹确认
  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    setChecking(true);
    setNoBom(false);
    setBom(null);
    setBomRejected(false);
    setBindConfirm(null);
    void (async () => {
      try {
        const list = await stylesApi.bomHeaders(ctx.货号);
        const hit = list.find((s) => s.款号 === ctx.货号) ?? null;
        if (!hit) {
          if (alive) setNoBom(true);
          return;
        }
        const po = (ctx.PO号 ?? "").trim();
        let others: string[] = [];
        if (po && hit.款号) {
          try {
            const bindings = await stylesApi.poBindings(hit.款号);
            others = bindings.map((b) => b.PO号).filter((p) => p && p !== po);
          } catch {
            others = []; // 绑定查询失败不阻塞下单流程
          }
        }
        if (!alive) return;
        if (others.length > 0) {
          setBindConfirm({ hit, 款号: hit.款号 ?? ctx.货号, po, others });
          return;
        }
        applyBom(hit);
      } catch {
        if (alive) setNoBom(true);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const goBuildBom = () => {
    if (!ctx) return;
    const url = bomSetupUrl(ctx);
    // /bom-setup 已注册(Batch 1)则真实跳转;未注册不跳断链,提示并记录参数(防回归兜底)
    if (!MENU_PATHS.has("/bom-setup")) {
      setToast({
        text: `BOM物料设置页未注册,请记下载建参数:款号=${ctx.货号}${ctx.PO号 ? ` PO=${ctx.PO号}` : ""}(老系统入口 ${url})`,
        tone: "ok",
      });
      return;
    }
    navigate(url);
  };

  const submit = async () => {
    if (!ctx || !bom?.款号) return;
    const qty = Number(form.数量);
    if (!Number.isFinite(qty) || qty <= 0) {
      setToast({ text: "请填写数量", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const r = await productionApi.create({
        客户编号: form.客户编号.trim() || undefined,
        客户名称: form.客户名称.trim() || undefined,
        客户款号: ctx.货号,
        合同号: ctx.PO号 || undefined,
        标识: "正单",
        订单总箱数: form.订单总箱数.trim() === "" ? undefined : Number(form.订单总箱数),
        默认单价: bom.默认单价 || undefined,
        交货日期: form.交货日期 || undefined,
        下单日期: form.下单日期 || undefined,
        备注: form.备注.trim() || undefined,
        货号明细: [
          {
            货号: ctx.货号,
            BOM款号: bom.款号,
            款号名称: bom.款式 || ctx.品名 || undefined,
            分析: true, // 与生产通知单页选货号一致:分析默认打勾
            数量明细: [{ 数量: qty }], // 排期无色码,一条无色码数量行(同通知单页手输数量)
          },
        ],
      });
      setToast({ text: `生产通知单已创建:${r.生产单号}(工序/物料已自动展开)`, tone: "ok" });
      onClose();
      // 成功后跳 /production 打开新单;路由未注册则留本页提示单号(Task 9 裁决模式)
      if (MENU_PATHS.has("/production")) {
        navigate(`/production?mo=${encodeURIComponent(r.生产单号)}`);
      }
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "生成生产通知单失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const okDisabled = noBom || checking || bomRejected || !bom || saving;

  return (
    <>
      <Dialog open={ctx !== null} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-black/10 bg-white text-[#1a2330] sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {ctx ? `排期行生成生产通知单(货号 ${ctx.货号})` : "生成生产通知单"}
            </DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              按排期行预填,保存后工序/物料由后端自动展开
            </DialogDescription>
          </DialogHeader>

          {bindConfirm ? (
            // BOM 已绑别的 PO:确认后才带入(文案对齐 Task 3 生产通知单页)
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1a2330]">
                <WarningCircle className="h-5 w-5 text-[#d97706]" />
                款号 {bindConfirm.款号} 的 BOM 已绑定其他 PO
              </div>
              <p className="text-sm text-[#5f6b7d]">该 BOM 已绑定以下 PO 号:</p>
              <ul className="list-disc space-y-1 pl-6 text-[15px] text-[#3d4a5c]">
                {bindConfirm.others.map((p) => (
                  <li key={p} className="f-mono">
                    {p}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-[#3d4a5c]">
                已绑定 PO：{bindConfirm.others.join("、")}，是否继续使用？
              </p>
              <p className="text-sm text-[#5f6b7d]">
                继续使用该 BOM 会把它与当前 PO({bindConfirm.po})一并绑定。
              </p>
              <DialogFooter>
                <button
                  type="button"
                  className="f-btn h-10 px-4"
                  onClick={() => {
                    setBindConfirm(null);
                    setBomRejected(true);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="f-btn f-btn-cyan h-10 px-4"
                  onClick={() => {
                    const hit = bindConfirm.hit;
                    setBindConfirm(null);
                    applyBom(hit);
                  }}
                >
                  继续使用
                </button>
              </DialogFooter>
            </div>
          ) : noBom ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-[15px] text-[#3d4a5c]">该货号还没有建 BOM,无法生成生产通知单</p>
              <p className="text-sm text-[#5f6b7d]">
                请先到「工程部 - BOM物料设置」为款号 {ctx?.货号} 建 BOM,再回来下单
              </p>
              <button type="button" className="f-btn f-btn-cyan h-10 px-5" onClick={goBuildBom}>
                <FilePlus className="h-4.5 w-4.5" />
                去建 BOM
              </button>
            </div>
          ) : bomRejected ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-[15px] text-[#3d4a5c]">该 BOM 已绑定其他 PO,已取消带入</p>
              <p className="text-sm text-[#5f6b7d]">
                可关闭本窗口,或到「BOM物料设置」为该 PO 新建/复制一张 BOM
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="计划数量(排期数量,可改)">
                <Input
                  type="number"
                  min={1}
                  aria-label="计划数量"
                  className={inputCls}
                  value={form.数量}
                  onChange={(e) => patch({ 数量: e.target.value })}
                />
              </Field>
              <Field label="客户名称(默认取 BOM 单头,其次排期客户名称)">
                <Input
                  aria-label="客户名称"
                  className={inputCls}
                  value={form.客户名称}
                  onChange={(e) => patch({ 客户名称: e.target.value })}
                />
              </Field>
              <Field label="客户编号(BOM 单头带出,可改)">
                <Input
                  aria-label="客户编号"
                  className={inputCls}
                  value={form.客户编号}
                  onChange={(e) => patch({ 客户编号: e.target.value })}
                />
              </Field>
              <Field label="订单总箱数(默认排期总箱数)">
                <Input
                  type="number"
                  min={0}
                  aria-label="订单总箱数"
                  className={inputCls}
                  value={form.订单总箱数}
                  onChange={(e) => patch({ 订单总箱数: e.target.value })}
                />
              </Field>
              <Field label="交货日期(默认排期走货期)">
                <Input
                  type="date"
                  aria-label="交货日期"
                  className={inputCls}
                  value={form.交货日期}
                  onChange={(e) => patch({ 交货日期: e.target.value })}
                />
              </Field>
              <Field label="下单日期(默认排期接单日期)">
                <Input
                  type="date"
                  aria-label="下单日期"
                  className={inputCls}
                  value={form.下单日期}
                  onChange={(e) => patch({ 下单日期: e.target.value })}
                />
              </Field>
              <div className="col-span-2">
                <Field label="备注">
                  <textarea
                    aria-label="备注"
                    rows={2}
                    className={cn(inputCls, "h-auto min-h-16 w-full rounded-md border px-3 py-2")}
                    value={form.备注}
                    onChange={(e) => patch({ 备注: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}

          {!bindConfirm && !noBom && !bomRejected && (
            <DialogFooter>
              <button type="button" className="f-btn h-10 px-4" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="f-btn f-btn-cyan h-10 px-4"
                disabled={okDisabled}
                onClick={() => void submit()}
              >
                生成生产通知单
              </button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </>
  );
}
