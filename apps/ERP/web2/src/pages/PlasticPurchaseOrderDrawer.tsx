// 塑胶采购订单新建抽屉(塑胶采购分析点行 / 塑胶采购订单页「二次加工下单」共用)。
// 对照老系统 web/src/pages/plastics/PlasticPurchaseOrderDrawer.tsx:
// 选供应商 -> 勾选物料(已下单/库存已够的默认不勾) -> 保存下单;重复下单先确认;
// 「计算库存」勾选(默认勾)=订购数量 需求−可用库存,取消=全量需求;下方同模面板显示一套模明细(啤数/堵模);
// 编号=生产单合同号自动填入;生产单号可手输:输入=按生产单 BOM 带料(不看库存,一次/二次加工都能下,
// 不用等上道入仓),清空才回落按库存选料(一次加工取啤机单入仓产出,二次加工取一次加工入仓产出);
// 加工类型切换常显;按库存选料的单 加工内容 必填且 订购≤可用库存;
// 喷油供应商(名称含「喷油」)只下印喷类物料且 加工内容 必填;「从补料单带入」保存后标记已采购。
// 权限菜单=塑胶采购订单(MenuCatalog.cs:46 实证:塑胶采购组)。
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FloppyDisk } from "@phosphor-icons/react";
import {
  plasticPurchaseOrderApi,
  replenishmentApi,
} from "@/api/endpoints";
import type { ReplenishmentDetail, ReplenishmentHeader } from "@/api/types";
import { replenishPurchaseLines } from "@/lib/purchaseOrder";
import {
  applyStockDeduction,
  basisToLine,
  filterSubmitLines,
  is印喷,
  is喷油供应商,
  mergeProcessContents,
  moldGroups,
  plasticDefaultSelect,
  toSubmitLine,
  type PpoEditLine,
} from "@/lib/plasticPurchase";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocToast } from "@/components/doc/DocToast";
import { SupplierPickerDialog } from "@/components/doc/SupplierPickerDialog";
import { MoldGroupPanel } from "@/components/doc/MoldGroupPanel";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "塑胶采购订单";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const today = () => new Date().toISOString().slice(0, 10);

let rowSeq = 1;
const uid = () => rowSeq++;

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const cellInputCls =
  "h-8 w-full rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]";

interface DrawerHeader {
  供应商编号: string;
  供应商名称: string;
  交货日期: string;
  编号: string; // PO号(客户合同号)
  备注: string;
  加工内容: string; // 喷油供应商订单必选
  加工类型: string; // 一次加工(默认)/二次加工
}

const emptyHeader = (加工类型 = "一次加工"): DrawerHeader => ({
  供应商编号: "",
  供应商名称: "",
  交货日期: "",
  编号: "",
  备注: "",
  加工内容: "",
  加工类型,
});

export default function PlasticPurchaseOrderDrawer({
  open,
  生产单号,
  initial加工类型,
  库存加工,
  onClose,
  onSaved,
}: {
  open: boolean;
  生产单号?: string;
  initial加工类型?: string;
  // 按库存选料的加工下单(采购订单页「一次/二次加工下单」):一次加工取啤机单入仓产出,
  // 二次加工取一次加工入仓产出;不传则保持老行为(一次加工=按生产单 BOM 带料)
  库存加工?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { can } = usePerms();
  const canSave = can(MENU, "保存");

  const [header, setHeader] = useState<DrawerHeader>(emptyHeader());
  const [rows, setRows] = useState<PpoEditLine[]>([]);
  const [sel, setSel] = useState<ReadonlySet<number>>(new Set());
  // 生产单号:prop 传入或手输「带料」;有值=按生产单 BOM 带料(不看库存),清空=按库存选料
  const [moNo, setMoNo] = useState(生产单号);
  const [moInput, setMoInput] = useState(生产单号 ?? "");
  // 计算库存(仅按生产单带料模式):勾选=订购数量 需求−可用库存;取消=全量需求
  const [扣库存, set扣库存] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [replOpen, setReplOpen] = useState(false);
  // 本次已带入的补料单号(保存成功后逐个标记已采购)
  const [replMarked, setReplMarked] = useState<string[]>([]);
  const [confirmOrderedOpen, setConfirmOrderedOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 加工内容下拉选项:接口值(塑胶物料资料/共用物料表去重)并上固定集合
  const contentsQuery = useQuery({
    queryKey: ["ppo", "processing-contents"],
    queryFn: () => plasticPurchaseOrderApi.processingContents(),
    enabled: open,
  });
  const 加工内容选项 = mergeProcessContents(contentsQuery.data ?? []);

  // 待采购补料单(塑胶仓 · 已审核未采购)
  const replQuery = useQuery({
    queryKey: ["ppo", "replenishments"],
    queryFn: () => replenishmentApi.list(1, 100, "", undefined, "塑胶仓", true),
    enabled: replOpen,
  });

  const setHead = (patch: Partial<DrawerHeader>) => setHeader((h) => ({ ...h, ...patch }));
  const patchRow = (key: number, patch: Partial<PpoEditLine>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const 喷油单 = is喷油供应商(header.供应商名称);
  const 二次加工 = header.加工类型 === "二次加工";
  // 生产单号优先:有值=按生产单 BOM 带料(不看库存,一次/二次都能下,不用等上道入仓);
  // 清空才按库存选料(库存加工抽屉的一次/二次,或老行为二次加工):行来自库存,无行级加工内容,不做行级裁剪
  const mo带料 = !!(moNo ?? "").trim();
  const 按库存 = !mo带料 && (库存加工 === true || 二次加工);
  // 单头选了加工内容:只列出行级加工内容相同的物料(去空白后精确匹配)
  const 同加工内容 = (r: PpoEditLine) =>
    !header.加工内容 || (r.加工内容 ?? "").trim() === header.加工内容.trim();
  const visibleRows = 按库存
    ? // 按库存:选了加工内容(如印喷)只显示需要该工序的库存件(需求加工内容=物料资料/BOM),清空显示全部
      header.加工内容
      ? rows.filter((r) => (r.需求加工内容 ?? "").trim() === header.加工内容.trim())
      : rows
    : rows.filter((r) => (!喷油单 || is印喷(r.加工内容)) && 同加工内容(r));

  // 阶段已订:啤机(未选加工内容)看 已订啤机;选了工序只看同工序已订——
  // 下印喷单不被啤机阶段已订误判重复;无阶段字段的行(按库存/手工)保持原值
  const stageRows = (rs: PpoEditLine[], 工序: string) =>
    rs.map((r) =>
      r.已订啤机数量 == null && r.已订同工序数量 == null
        ? r
        : { ...r, 已订数量: 工序 ? Number(r.已订同工序数量 ?? 0) : Number(r.已订啤机数量 ?? 0) },
    );

  // 新建模式按生产单 basis 预填;编号=生产通知单.合同号(客户合同号即PO号)
  // 默认勾选按全量需求判定(plasticDefaultSelect),再按「计算库存」扣减可用库存得到订购数量
  const loadBasis = async (mo: string, deduct: boolean) => {
    setLoading(true);
    try {
      const basis = await plasticPurchaseOrderApi.basis(mo);
      const rs = basis.map((b) => basisToLine(b, uid()));
      setHeader((h) => ({ ...h, 编号: h.编号 || basis[0]?.合同号 || "" }));
      // 先按当前加工阶段改写 已订数量(啤机=已订啤机,选了工序=同工序),再做默认勾选判定
      const staged = stageRows(rs, header.加工内容);
      // 已下单/库存已够的行默认不勾选,防重复下单/多余采购
      setSel(new Set(staged.filter(plasticDefaultSelect).map((r) => r.key)));
      setRows(applyStockDeduction(staged, deduct));
      if (rs.length === 0) setToast({ text: "该生产单号没有塑胶采购物料", tone: "err" });
    } catch (e) {
      setToast({ text: errMsg(e) || "加载塑胶采购分析失败", tone: "err" });
    } finally {
      setLoading(false);
    }
  };

  // 按库存模式:一次加工取啤机单入仓产出,二次加工取一次加工入仓产出;数量默认=可用库存
  const loadStock = async (阶段: string) => {
    setLoading(true);
    try {
      const list = await plasticPurchaseOrderApi.secondProcessStock("", 阶段);
      const rs: PpoEditLine[] = list.map((s) => ({
        key: uid(),
        生产单号: s.生产单号,
        款号: s.款号,
        物料编号: s.物料编号,
        物料名称: s.物料名称,
        颜色: s.颜色,
        已加工工序: s.已加工工序,
        需求加工内容: s.需求加工内容,
        来源采购单号: s.来源采购单号,
        可用库存: s.可用库存,
        数量: String(s.可用库存),
        用量: "",
        套数: "",
      }));
      setRows(rs);
      setSel(new Set(rs.map((r) => r.key)));
      if (rs.length === 0)
        setToast({
          text:
            (阶段 === "二次加工"
              ? "没有可二次加工的库存(需先完成一次加工入仓)"
              : "没有可一次加工的库存(需先完成啤机单入仓)") +
            ";也可输入生产单号按单带料下单(不需要库存)",
          tone: "err",
        });
    } catch (e) {
      setToast({ text: errMsg(e) || "加载可加工库存失败", tone: "err" });
    } finally {
      setLoading(false);
    }
  };

  // 打开/切换时初始化(对照老系统 useEffect on open)
  useEffect(() => {
    if (!open) return;
    const t = initial加工类型 ?? "一次加工";
    setRows([]);
    setSel(new Set());
    setReplMarked([]);
    setHeader(emptyHeader(t));
    set扣库存(true);
    setMoNo(生产单号);
    setMoInput(生产单号 ?? "");
    if (生产单号) void loadBasis(生产单号, true);
    else if (库存加工 || t === "二次加工") void loadStock(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, 生产单号, initial加工类型]);

  // 生产单号「带料」(按钮/回车):有值=按生产单 BOM 带料(不看库存);清空=回到按库存选料
  const applyMo = async () => {
    const mo = moInput.trim();
    setRows([]);
    setSel(new Set());
    set扣库存(true);
    setMoNo(mo || undefined);
    if (mo) await loadBasis(mo, true);
    else if (库存加工 || 二次加工) await loadStock(header.加工类型);
  };

  // 切换加工类型:按生产单带料时只换单头标签(行不动,不看库存);按库存选料时重置明细重新取数
  const apply加工类型 = (v: string) => {
    setHeader((h) => ({ ...h, 加工类型: v, ...(mo带料 ? {} : { 加工内容: "" }) }));
    if (mo带料) return;
    setRows([]);
    setSel(new Set());
    set扣库存(true);
    if (库存加工 || v === "二次加工") void loadStock(v);
  };

  // 「计算库存」勾选切换:订购数量在 需求 与 需求−可用库存 间重算(只影响 basis 行,手改会被重算覆盖)
  const toggle扣库存 = (v: boolean) => {
    set扣库存(v);
    setRows((rs) => applyStockDeduction(rs, v));
  };

  // 选/改加工内容时自动勾选筛选后的行(仍跳过已下单/库存已够的);清空时回到默认勾选
  const apply加工内容 = (v: string) => {
    setHead({ 加工内容: v });
    if (按库存) {
      // 按库存:勾选需求工序匹配的库存件(清空=全选)
      const 范围 = v ? rows.filter((r) => (r.需求加工内容 ?? "").trim() === v.trim()) : rows;
      setSel(new Set(范围.map((r) => r.key)));
      return;
    }
    // 先按新工序改写 已订数量(同工序口径),再筛选/勾选——下印喷单不被啤机已订误判重复
    const staged = stageRows(rows, v);
    setRows(staged);
    const 范围 = staged.filter(
      (r) =>
        (!is喷油供应商(header.供应商名称) || is印喷(r.加工内容)) &&
        (!v || (r.加工内容 ?? "").trim() === v.trim()),
    );
    setSel(new Set(范围.filter(plasticDefaultSelect).map((r) => r.key)));
  };

  // 选供应商:改选喷油部时勾选裁剪到印喷类行
  const onPickSupplier = (s: { 供应商编号?: string; 供应商名称?: string }) => {
    const 名称 = s.供应商名称 ?? "";
    setHead({ 供应商编号: s.供应商编号 ?? "", 供应商名称: 名称 });
    if (名称.includes("喷油") && !按库存) {
      const 印喷行 = rows.filter(
        (r) =>
          is印喷(r.加工内容) &&
          (!header.加工内容 || (r.加工内容 ?? "").trim() === header.加工内容.trim()),
      );
      setSel((prev) => new Set([...prev].filter((k) => 印喷行.some((r) => r.key === k))));
      if (rows.length > 0 && 印喷行.length === 0)
        setToast({
          text: "该生产单没有加工内容含「喷/印」的物料(塑胶物料资料.加工内容 未标「喷油/移印」),无法下给喷油部",
          tone: "err",
        });
    }
  };

  // 从补料单带入:补料明细行追加进网格并默认勾选(数量=补料数量),保存成功后标记该补料单已采购
  const bringReplenishment = (d: ReplenishmentDetail) => {
    const rs: PpoEditLine[] = replenishPurchaseLines(d).map((l) => ({
      key: uid(),
      生产单号: l.生产单号 ?? moNo,
      款号: l.款号,
      物料编号: l.物料编号,
      物料名称: l.物料名称,
      颜色: l.颜色,
      数量: String(l.数量),
      用量: "",
      套数: "",
    }));
    if (rs.length === 0) {
      setToast({ text: "该补料单没有可带入的物料行", tone: "err" });
      return;
    }
    setRows((prev) => [...prev, ...rs]);
    setSel((prev) => new Set([...prev, ...rs.map((r) => r.key)]));
    if (d.单头?.单号) setReplMarked((prev) => [...new Set([...prev, d.单头!.单号!])]);
    setToast({ text: `已从补料单 ${d.单头?.单号 ?? ""} 带入 ${rs.length} 行`, tone: "ok" });
    setReplOpen(false);
  };

  // 实际提交
  const doSave = async () => {
    if (!header.供应商编号.trim()) {
      setToast({ text: "请选择供应商", tone: "err" });
      return;
    }
    if (喷油单 && !header.加工内容) {
      setToast({ text: "喷油加工订单必须选择加工内容", tone: "err" });
      return;
    }
    if (按库存 && !header.加工内容) {
      setToast({ text: "按库存加工下单必须选择加工内容(未选加工内容不算一次/二次加工)", tone: "err" });
      return;
    }
    const chosen = visibleRows.filter((r) => sel.has(r.key));
    if (chosen.length === 0) {
      setToast({ text: "请勾选要下单的物料行", tone: "err" });
      return;
    }
    if (按库存) {
      const over = chosen.filter((r) => Number(r.数量) > Number(r.可用库存 ?? 0));
      if (over.length > 0) {
        setToast({
          text: `${header.加工类型}数量超过可用库存:${over.map((r) => `${r.物料编号}(库存 ${r.可用库存})`).join("、")}`,
          tone: "err",
        });
        return;
      }
    }
    const { kept, dropped喷油, dropped加工 } = filterSubmitLines(chosen, {
      喷油单,
      加工内容: header.加工内容,
      二次加工: 按库存,
    });
    if (dropped喷油 > 0)
      setToast({ text: `喷油部只收印喷类物料:已剔除 ${dropped喷油} 行明细`, tone: "err" });
    if (dropped加工 > 0)
      setToast({ text: `已剔除 ${dropped加工} 行加工内容不是「${header.加工内容}」的明细`, tone: "err" });
    if (kept.length === 0) {
      setToast({ text: "请至少录入一行数量>0的明细", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const r = await plasticPurchaseOrderApi.create({
        供应商编号: header.供应商编号.trim(),
        供应商名称: header.供应商名称.trim() || undefined,
        交货日期: header.交货日期 || undefined,
        编号: header.编号.trim() || undefined,
        备注: header.备注.trim() || undefined,
        加工内容: header.加工内容 || undefined,
        加工类型: header.加工类型,
        库存加工: 按库存 || undefined,
        明细: kept.map((l) =>
          toSubmitLine({
            ...l,
            生产单号: l.生产单号 ?? moNo,
            // 按库存加工:行级没有加工内容,把单头选的工序落到每行,入仓后工序快照有据可查
            加工内容: 按库存 ? header.加工内容 || l.加工内容 : l.加工内容,
          }),
        ),
      });
      setToast({ text: `塑胶采购订单已创建:${r.单号}`, tone: "ok" });
      // 带入过补料单:保存成功后标记已采购(静默失败只提示手动处理)
      for (const no of replMarked) {
        try {
          await replenishmentApi.markPurchased(no);
        } catch (e) {
          setToast({ text: errMsg(e) || `补料单 ${no} 标记「已采购」失败,请在补料单页手动核对`, tone: "err" });
        }
      }
      setReplMarked([]);
      onSaved?.();
      onClose();
    } catch (e) {
      setToast({ text: errMsg(e) || "保存失败", tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  // 保存入口:勾选中包含「已下单」物料时先弹确认,防重复下单
  const save = () => {
    const ordered = rows.filter((r) => sel.has(r.key) && Number(r.已订数量) > 0);
    if (ordered.length === 0) {
      void doSave();
      return;
    }
    setConfirmOrderedOpen(true);
  };

  const chosenRows = visibleRows.filter((r) => sel.has(r.key));
  const totalQty = chosenRows.reduce((s, r) => s + (Number(r.数量) || 0), 0);
  const orderedRows = useMemo(
    () => rows.filter((r) => sel.has(r.key) && Number(r.已订数量) > 0),
    [rows, sel],
  );
  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => sel.has(r.key));
  const toggleAll = () => {
    if (allChecked) setSel(new Set());
    else setSel(new Set(visibleRows.map((r) => r.key)));
  };
  const toggleOne = (key: number) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 明细列(按库存模式列不同;对照老系统 columns 两种形态)
  const headCells = 按库存
    ? ["", "序号", "物料编号", "物料名称", 二次加工 ? "已加工工序" : "需求加工内容", "来源采购单", "生产单号", "颜色", "可用库存", "订购数量", "备注"]
    : ["", "序号", "物料编号", "物料名称", "模具编号", "颜色", "色粉号", "用料名称", "加工内容", "用量", "套数", "需求数量", "可用库存", "订购数量", "已订数量", "备注"];

  return (
    <>
      <PickerDialog
        open={open}
        onClose={onClose}
        title={`塑胶采购订单(新建)${按库存 ? ` · ${header.加工类型}` : ""}${mo带料 ? ` · ${moNo}${二次加工 ? " · 二次加工" : ""}` : ""}`}
        width="sm:max-w-[1080px]"
        footer={
          <>
            <span className="mr-auto text-sm text-[#5f6b7d]">
              {按库存
                ? header.加工类型 === "二次加工"
                  ? `二次加工:只列出已完成一次加工入仓且有库存的物料 ${visibleRows.length} 行,已勾选 ${chosenRows.length} 行;订购数量默认=可用库存,不得超过库存;没有库存可输生产单号按单带料`
                  : `一次加工:只列出啤机单入仓且有库存的物料 ${visibleRows.length} 行,已勾选 ${chosenRows.length} 行;订购数量默认=可用库存,不得超过库存;没有库存可输生产单号按单带料`
                : 喷油单
                  ? `喷油单:已按加工内容(含「喷/印」)筛选出 ${visibleRows.length} 行印喷类物料,已勾选 ${chosenRows.length} / ${visibleRows.length} 行`
                  : `已勾选 ${chosenRows.length} / ${visibleRows.length} 行,勾选的物料才会下单到当前供应商;订购数量默认=${扣库存 ? "需求数量−可用库存(计算库存已勾)" : "计划数量×用量"},可改`}
              {按库存 && header.加工内容
                ? `;加工内容「${header.加工内容}」:只显示需要该工序的物料`
                : !按库存 && header.加工内容
                  ? `;加工内容「${header.加工内容}」已自动筛选相同物料`
                  : ""}
            </span>
            <span className="f-mono mr-3 text-sm font-semibold text-[#1a2330]">
              数量合计:{totalQty}
            </span>
            {canSave && (
              <button
                type="button"
                className="f-btn f-btn-cyan px-5"
                disabled={saving || loading}
                onClick={save}
              >
                <FloppyDisk className="h-4.5 w-4.5" />
                {saving ? "保存中..." : "保存"}
              </button>
            )}
          </>
        }
      >
        {/* 单头 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <label className="block">
            <span className="f-label">供应商 *</span>
            <div className="mt-1 flex gap-2">
              <Input
                className={inputCls}
                readOnly
                aria-label="供应商"
                placeholder="编号 / 名称"
                value={
                  header.供应商编号
                    ? `${header.供应商编号} ${header.供应商名称}`.trim()
                    : header.供应商名称
                }
              />
              <button
                type="button"
                className="f-btn h-10 shrink-0 px-3.5 text-sm"
                onClick={() => setSupplierOpen(true)}
              >
                选择
              </button>
            </div>
          </label>
          <label className="block">
            <span className="f-label">日期</span>
            <Input className={cn(inputCls, "mt-1")} aria-label="日期" value={today()} disabled />
          </label>
          <label className="block">
            <span className="f-label">交货日期</span>
            <input
              type="date"
              aria-label="交货日期"
              className={cn("f-input mt-1 w-full")}
              value={header.交货日期}
              onChange={(e) => setHead({ 交货日期: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="f-label">PO号</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="PO号"
              placeholder="客户 PO号(默认=合同号)"
              value={header.编号}
              onChange={(e) => setHead({ 编号: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="f-label">生产单号</span>
            <div className="mt-1 flex gap-2">
              <Input
                className={inputCls}
                aria-label="生产单号"
                value={moInput}
                placeholder={库存加工 ? "输生产单号=按单带料(不要库存)" : "生产通知单号"}
                onChange={(e) => setMoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void applyMo();
                }}
              />
              <button
                type="button"
                className="f-btn h-10 shrink-0 px-3.5 text-sm"
                title="按生产单 BOM 带料(不需要库存);清空后点带料=回到按库存选料"
                onClick={() => void applyMo()}
              >
                带料
              </button>
            </div>
          </label>
          <div className="block">
            <span className="f-label">加工类型</span>
            <div className="mt-1 flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
              {(["一次加工", "二次加工"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => apply加工类型(v)}
                  className={cn(
                    "h-9 flex-1 rounded-lg px-3 text-sm transition-colors",
                    header.加工类型 === v
                      ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                      : "text-[#5f6b7d] hover:text-[#3d4a5c]",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="f-label">
              加工内容{(喷油单 || 按库存) && <span className="text-[#dc2626]"> *</span>}
            </span>
            <SearchSelect
              ariaLabel="加工内容"
              className={cn(inputCls, "mt-1 rounded-md border")}
              value={header.加工内容}
              options={加工内容选项.map((v) => ({ value: v, label: v }))}
              placeholder="请选择"
              clearLabel="请选择"
              onChange={(v) => apply加工内容(v)}
            />
            {mo带料 && (
              <span className="mt-1 block text-xs leading-4 text-[#8a94a6]">
                选加工内容=下该工序的加工单(如喷油),与啤机单同时下,不用等入仓;不选=啤机单
              </span>
            )}
          </label>
          <label className="block">
            <span className="f-label">备注</span>
            <Input
              className={cn(inputCls, "mt-1")}
              aria-label="备注"
              value={header.备注}
              onChange={(e) => setHead({ 备注: e.target.value })}
            />
          </label>
        </div>

        {!按库存 && (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              onClick={() => setReplOpen(true)}
            >
              从补料单带入
            </button>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#3d4a5c]">
              <Checkbox
                aria-label="计算库存"
                className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                checked={扣库存}
                onCheckedChange={(v) => toggle扣库存(v === true)}
              />
              计算库存(订购数量 = 需求数量 − 可用库存,库存够的行变为 0;手改过的数量会被重算)
            </label>
          </div>
        )}

        {/* 明细网格 */}
        <div className="mt-3 overflow-auto">
          <table data-freeze className="w-full min-w-[1400px] text-sm">
            <thead>
              <tr>
                {headCells.map((h, i) =>
                  i === 0 ? (
                    <th key="_sel" className={cn(pickerThCls, "w-10 text-center")}>
                      <Checkbox
                        aria-label="全选"
                        className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                        checked={allChecked}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                  ) : (
                    <th
                      key={h}
                      className={cn(
                        pickerThCls,
                        (h === "用量" ||
                          h === "套数" ||
                          h === "需求数量" ||
                          h === "可用库存" ||
                          h === "订购数量" ||
                          h === "已订数量") &&
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
              {loading ? (
                <tr>
                  <td colSpan={headCells.length} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={headCells.length} className="px-3 py-8 text-center text-sm text-disabled">
                    {按库存
                      ? `${二次加工 ? "没有可二次加工的库存" : "没有可一次加工的库存"};可直接输入生产单号按单带料下单(不需要库存)`
                      : "暂无物料行"}
                  </td>
                </tr>
              ) : (
                visibleRows.map((r, i) => {
                  // 库存够判定按需求口径(有基准需求按需求;扣库存后订购数量变小不影响「库存已够」标绿)
                  const 需求 = Number(r.需求数量 ?? r.数量 ?? 0);
                  const enough = r.可用库存 != null && 需求 > 0 && Number(r.可用库存) >= 需求;
                  return (
                    <tr key={r.key} className="border-b border-black/6 last:border-0">
                      <td className="px-3 py-1.5 text-center">
                        <Checkbox
                          aria-label={`选择 ${r.物料编号 ?? i + 1}`}
                          className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                          checked={sel.has(r.key)}
                          onCheckedChange={() => toggleOne(r.key)}
                        />
                      </td>
                      <td className="f-mono px-3 py-1.5 text-[#5f6b7d]">{i + 1}</td>
                      <td className="f-mono px-3 py-1.5 font-semibold whitespace-nowrap text-[#1a2330]">
                        {r.物料编号}
                      </td>
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.物料名称}</td>
                      {按库存 ? (
                        <>
                          <td className="px-3 py-1.5">
                            {二次加工 ? (
                              r.已加工工序 ? (
                                <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#15803d]">
                                  已加工:{r.已加工工序}
                                </span>
                              ) : (
                                ""
                              )
                            ) : (
                              <span className="whitespace-nowrap text-[#3d4a5c]">{r.需求加工内容 ?? ""}</span>
                            )}
                          </td>
                          <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">
                            {r.来源采购单号 ?? ""}
                          </td>
                          <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">
                            {r.生产单号 ?? ""}
                          </td>
                        </>
                      ) : (
                        <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">
                          {r.模具编号 ?? ""}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.颜色 ?? ""}</td>
                      {!按库存 && (
                        <>
                          <td className="px-3 py-1.5 text-[#3d4a5c]">{r.色粉号 ?? ""}</td>
                          <td className="px-3 py-1.5 text-[#3d4a5c]">{r.用料名称 ?? ""}</td>
                          <td className="px-3 py-1.5 text-[#3d4a5c]">{r.加工内容 ?? ""}</td>
                          <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{r.用量}</td>
                          <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{r.套数}</td>
                          <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">
                            {r.需求数量 ?? "-"}
                          </td>
                        </>
                      )}
                      <td className="f-mono px-3 py-1.5 text-right">
                        {r.可用库存 == null ? (
                          <span className="text-disabled">-</span>
                        ) : enough ? (
                          <span
                            className="font-semibold text-[#15803d]"
                            title="实时库存已够需求,默认不勾选下单"
                          >
                            {r.可用库存}
                          </span>
                        ) : (
                          <span className="text-[#3d4a5c]">{r.可用库存}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={cn(cellInputCls, "w-24 text-right")}
                          aria-label={`订购数量 ${r.物料编号 ?? i + 1}`}
                          type="number"
                          min={0}
                          max={按库存 && r.可用库存 != null ? Number(r.可用库存) : undefined}
                          value={r.数量}
                          onChange={(e) => patchRow(r.key, { 数量: e.target.value })}
                        />
                      </td>
                      {!按库存 && (
                        <td className="px-3 py-1.5 text-right">
                          {Number(r.已订数量) > 0 ? (
                            <span
                              className="inline-flex rounded-full border border-[#d97706]/50 bg-[#d97706]/10 px-2 py-0.5 text-xs font-semibold text-[#b45309]"
                              title="该工作单已下过此物料,重复下单会重复采购"
                            >
                              已下单 {r.已订数量}
                            </span>
                          ) : (
                            <span className="text-disabled">-</span>
                          )}
                        </td>
                      )}
                      <td className="px-2 py-1.5">
                        <input
                          className={cn(cellInputCls, "w-28")}
                          aria-label={`备注 ${r.物料编号 ?? i + 1}`}
                          value={r.备注 ?? ""}
                          onChange={(e) => patchRow(r.key, { 备注: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 一套模明细(同模分组·啤数/堵模):与可见行联动,改数量/勾选实时重算 */}
        {!按库存 && <MoldGroupPanel groups={moldGroups(visibleRows)} />}
      </PickerDialog>

      <SupplierPickerDialog
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        onPick={onPickSupplier}
      />

      {/* 从补料单带入(塑胶仓 · 已审核未采购) */}
      <PickerDialog
        open={replOpen}
        onClose={() => setReplOpen(false)}
        title="从补料单带入(塑胶仓 · 已审核未采购)"
        width="sm:max-w-[860px]"
      >
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["单号", "日期", "部门", "生产单号", "款号", "数量合计", ""].map((h) => (
                <th key={h} className={cn(pickerThCls, h === "数量合计" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(replQuery.data?.items ?? []).map((r: ReplenishmentHeader) => (
              <tr key={r.单号} className="h-11 border-b border-black/6 last:border-0">
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.单号}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                  {r.日期 ? String(r.日期).slice(0, 10) : ""}
                </td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.部门 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.生产单号 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.款号 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.数量 ?? 0}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#15803d] hover:underline"
                    onClick={() =>
                      void replenishmentApi
                        .get(r.单号!)
                        .then(bringReplenishment)
                        .catch(() => setToast({ text: "打开补料单失败", tone: "err" }))
                    }
                  >
                    带入
                  </button>
                </td>
              </tr>
            ))}
            {replQuery.isSuccess && (replQuery.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-disabled">
                  无待采购补料单
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-[#5f6b7d]">
          点「带入」把该补料单全部物料追加进采购明细(数量=补料数量);采购订单保存成功后该补料单自动标记「已采购」,不再出现在本列表
        </p>
      </PickerDialog>

      {/* 重复下单确认(勾选中包含已下单物料) */}
      <ConfirmDialog
        open={confirmOrderedOpen}
        onClose={() => setConfirmOrderedOpen(false)}
        title="勾选项中包含已下单物料"
        description={
          <span>
            以下物料在此工作单已下过单(再下单会重复采购):
            {orderedRows.map((r) => (
              <span key={r.key} className="mt-1 block">
                {r.物料编号} {r.物料名称}(已订 {r.已订数量})
              </span>
            ))}
            <span className="mt-2 block">确认继续下单吗?</span>
          </span>
        }
        confirmLabel="仍要下单"
        onConfirm={() => {
          setConfirmOrderedOpen(false);
          void doSave();
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </>
  );
}
