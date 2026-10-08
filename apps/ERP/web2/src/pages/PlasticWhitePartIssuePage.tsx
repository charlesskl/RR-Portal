// 白件领料单(/plastic-white-part-issue;权限菜单=白件领料单,MenuCatalog.cs:23 实证:发外加工组)。
// 对照老系统 web/src/pages/plastics/PlasticWhitePartIssuePage.tsx + PlasticWhitePartIssueLineTable.tsx:
// 单头(部门=加工厂下拉/日期/领料人(人事档案选择器,必填)/操作员/电脑单号/胶箱数/卡板数/领料备注/备注)
// + 可编辑明细(无价格列;生产单号/款号走生产制单选择器,物料编号走塑胶物料选择器)
// + 下方单据列表(点单号查看=只读;行内 主管审核/经理审核/审核(下发)/反审核/删除 三级流转)。
// 调入清单:按生产单带白件 BOM(数量默认 0 手填)。
// 打印:老系统 window.print() 打整页,新版开新窗口渲染单头+明细(与半成品单据同口径)。
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router";
import {
  CaretLeft,
  CaretRight,
  FilePlus,
  FloppyDisk,
  Printer,
  Prohibit,
  X,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { factoriesApi, plasticWhitePartIssueApi } from "@/api/endpoints";
import type { WPILine, WPIHeader } from "@/api/types";
import { getUser } from "@/lib/auth";
import {
  chainBadge,
  printProcessDoc,
  validateWpiLines,
  validWpiLines,
  WPI_PRINT_CFG,
} from "@/lib/processDocs";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { EmployeePickerDialog } from "@/components/doc/EmployeePickerDialog";
import { ProductionPickerDialog } from "@/components/doc/ProductionPickerDialog";
import { PlasticMaterialPickerDialog } from "@/components/doc/PlasticMaterialPickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "白件领料单";
const LIST_SIZE = 10; // 单据列表每页 10 行(对照老系统 pagination.pageSize;一次取 50 行客户端分页)
const FETCH_SIZE = 50;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const today = () => new Date().toISOString().slice(0, 10); // ISO 格式:后端 DateTime 反序列化要求
const currentUser = () => getUser() ?? "";
const d10 = (v?: string) => (v ? v.slice(0, 10) : "");

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
// 表头四律:sticky + 不透明白底 + z-10 + nowrap(本页为自定义表格:可编辑明细+行内操作)
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
const cellCls = "px-2 py-1.5";

// 领料备注下拉选项(对照老系统 8 项,默认 生产领料)
const ISSUE_REMARKS = [
  "生产领料",
  "生产补料",
  "装配补料",
  "外发补料",
  "次品损耗",
  "跟客样办领料",
  "工程样办领料",
  "其他",
];

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="f-label">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

interface HeaderForm {
  领料部门: string;
  日期: string;
  领料人: string;
  操作员: string;
  电脑单号: string;
  胶箱数: string;
  卡板数: string;
  领料备注: string;
  备注: string;
}

const emptyHeader = (): HeaderForm => ({
  领料部门: "",
  日期: today(),
  领料人: "",
  操作员: currentUser(),
  电脑单号: "",
  胶箱数: "",
  卡板数: "",
  领料备注: "生产领料",
  备注: "",
});

export default function PlasticWhitePartIssuePage() {
  const navigate = useNavigate();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");

  const [form, setForm] = useState<HeaderForm>(emptyHeader);
  const [lines, setLines] = useState<WPILine[]>([]);
  const [listPage, setListPage] = useState(1);
  const [opened, setOpened] = useState<string | null>(null);
  const [openedHeader, setOpenedHeader] = useState<WPIHeader | null>(null);
  const [saving, setSaving] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, tone: "ok" | "err") => setToast({ text, tone }), []);

  const readOnly = opened !== null;

  // 部门=加工厂(发外加工:白件领给加工厂),选项来自加工厂资料(对照老系统 factoryOpts)
  const factoriesQuery = useQuery({
    queryKey: ["wpi-factories"],
    queryFn: () => factoriesApi.list(1, 500),
    enabled: canOpen && !permsLoading,
  });
  const factoryOpts = (factoriesQuery.data?.items ?? []).filter((f) => f.加工厂名称);

  // 单据列表(一次取 50 行,客户端分页 10/页,对照老系统 list(1,50)+pageSize 10)
  const listQuery = useQuery({
    queryKey: ["wpi-list"],
    queryFn: () => plasticWhitePartIssueApi.list(1, FETCH_SIZE, ""),
    enabled: canOpen && !permsLoading,
  });
  const rows = listQuery.data?.items ?? [];
  const loadRows = useCallback(async () => {
    await listQuery.refetch();
  }, [listQuery]);

  const reset = useCallback(() => {
    setForm(emptyHeader());
    setLines([]);
    setOpened(null);
    setOpenedHeader(null);
  }, []);

  // 调入清单:按生产单带白件 BOM(数量默认 0 手填)
  const bringFromProduction = async (生产单号: string) => {
    if (!生产单号) return;
    try {
      const bom = await plasticWhitePartIssueApi.basis(生产单号);
      setLines(
        bom.map((b) => ({
          发外采购: undefined,
          生产单号: b.生产单号,
          款号: b.款号,
          模具编号: b.模具编号,
          物料编号: b.物料编号,
          物料名称: b.物料名称,
          颜色: b.颜色,
          用料名称: b.用料名称,
          单位: b.单位,
          数量: 0,
        })),
      );
      notify(`已调入生产单 ${生产单号} 的白件清单`, "ok");
    } catch (e) {
      notify(errMsg(e) || "调入清单失败", "err");
    }
  };

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticWhitePartIssueApi.get(单号);
      const h = d.单头 ?? ({} as WPIHeader);
      setForm({
        领料部门: h.领料部门 ?? "",
        日期: d10(h.日期) || today(),
        领料人: h.领料人 ?? "",
        操作员: h.操作员 ?? "",
        电脑单号: h.电脑单号 ?? "",
        胶箱数: h.胶箱数 == null ? "" : String(h.胶箱数),
        卡板数: h.卡板数 == null ? "" : String(h.卡板数),
        领料备注: h.领料备注 ?? "生产领料",
        备注: h.备注 ?? "",
      });
      setLines(d.明细 ?? []);
      setOpened(单号);
      setOpenedHeader(h);
    } catch (e) {
      notify(errMsg(e) || "打开白件领料单失败", "err");
    }
  };

  const save = async () => {
    if (readOnly) {
      notify("查看模式:请先「新建」再录入", "err");
      return;
    }
    if (!form.领料人.trim()) {
      notify("请选领料人", "err");
      return;
    }
    const issue = validateWpiLines(lines);
    if (issue) {
      notify(issue, "err");
      return;
    }
    setSaving(true);
    try {
      await plasticWhitePartIssueApi.create({
        领料部门: form.领料部门 || undefined,
        日期: form.日期 || undefined,
        领料人: form.领料人,
        操作员: form.操作员 || undefined,
        电脑单号: form.电脑单号 || undefined,
        胶箱数: form.胶箱数 === "" ? null : Number(form.胶箱数),
        卡板数: form.卡板数 === "" ? null : Number(form.卡板数),
        领料备注: form.领料备注 || undefined,
        备注: form.备注 || undefined,
        明细: validWpiLines(lines),
      });
      notify("白件领料单已创建", "ok");
      reset();
      void loadRows();
    } catch (e) {
      notify(errMsg(e) || "创建失败", "err");
    } finally {
      setSaving(false);
    }
  };

  // 列表行内流转操作(对照老系统 act:成功 toast + 重载列表)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok, "ok");
      void loadRows();
    } catch (e) {
      notify(errMsg(e) || "操作失败", "err");
    }
  };

  const doPrint = () => {
    printProcessDoc(
      `白件领料单${opened ? ` ${opened}` : ""}`,
      {
        单头: { ...form, 单号: opened ?? "" } as Record<string, unknown>,
        明细: lines.filter((l) => l.物料编号) as unknown as Record<string, unknown>[],
      },
      WPI_PRINT_CFG,
    );
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);

  // ---------- 明细编辑 ----------
  const setLine = (i: number, patch: Partial<WPILine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setLinesShown: Dispatch<SetStateAction<WPILine[]>> = setLines;

  // ---------- 单据列表(客户端分页 10/页) ----------
  const listTotalPages = Math.max(1, Math.ceil(rows.length / LIST_SIZE));
  const listRows = rows.slice((listPage - 1) * LIST_SIZE, listPage * LIST_SIZE);

  const editActions: DocAction[] = [
    { key: "new", label: "新建", icon: FilePlus, success: true, onClick: reset },
    {
      key: "save",
      label: "保存",
      icon: FloppyDisk,
      perm: "保存",
      primary: true,
      disabled: readOnly || saving,
      disabledTitle: readOnly ? "打开的单据为查看态" : undefined,
      onClick: () => void save(),
    },
    { key: "bring", label: "调入清单", disabled: readOnly, disabledTitle: readOnly ? "打开的单据为查看态" : undefined, onClick: () => setProdOpen(true) },
    { key: "print", label: "打印", icon: Printer, perm: "打印", onClick: doPrint },
    {
      key: "close",
      label: "关闭",
      icon: X,
      danger: true,
      onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")),
    },
  ];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「白件领料单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-4 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">
          白件领料单{opened ? `(查看 ${opened})` : "(新建)"}
        </h1>
        {opened && openedHeader && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
              chainBadge(openedHeader)[0],
            )}
          >
            {chainBadge(openedHeader)[1]}
          </span>
        )}
        <div className="ml-auto">
          <FlowSteps
            steps={["开单", "主管审核", "经理审核", "审核下发"]}
            current={
              openedHeader?.审核 === "1"
                ? 3
                : openedHeader?.经理审核 === "1"
                  ? 2
                  : openedHeader?.主管审核 === "1"
                    ? 1
                    : 0
            }
          />
        </div>
      </div>

      <DocToolbar actions={editActions} menuKey={MENU} />

      {/* 单头表单(对照老系统 Form 栅格) */}
      <div className="f-panel p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3 lg:grid-cols-5">
          <FormField label="部门">
            <SearchSelect
              ariaLabel="领料部门"
              disabled={readOnly}
              value={form.领料部门}
              options={factoryOpts.map((f) => ({
                value: String(f.加工厂名称),
                label: [f.加工厂编号 ?? "", f.加工厂名称 ?? ""].filter(Boolean).join(" "),
              }))}
              placeholder="选择加工厂"
              clearLabel="选择加工厂"
              onChange={(v) => setForm((f) => ({ ...f, 领料部门: v }))}
            />
          </FormField>
          <FormField label="日期">
            <Input className={inputCls} aria-label="日期" disabled value={form.日期} />
          </FormField>
          <FormField label="领料人">
            <div className="flex gap-2">
              <Input
                className={inputCls}
                aria-label="领料人"
                readOnly
                placeholder="点「选」选人"
                value={form.领料人}
              />
              <button
                type="button"
                className="f-btn h-10 shrink-0 px-3 text-sm"
                aria-label="领料人选择"
                disabled={readOnly}
                onClick={() => setEmpOpen(true)}
              >
                选
              </button>
            </div>
          </FormField>
          <FormField label="操作员">
            <Input className={inputCls} aria-label="操作员" disabled value={form.操作员} />
          </FormField>
          <FormField label="电脑单号">
            <Input className={inputCls} aria-label="电脑单号" disabled value={form.电脑单号} />
          </FormField>
          <FormField label="胶箱数">
            <Input
              type="number"
              min={0}
              className={inputCls}
              aria-label="胶箱数"
              disabled={readOnly}
              value={form.胶箱数}
              onChange={(e) => setForm((f) => ({ ...f, 胶箱数: e.target.value }))}
            />
          </FormField>
          <FormField label="卡板数">
            <Input
              type="number"
              min={0}
              className={inputCls}
              aria-label="卡板数"
              disabled={readOnly}
              value={form.卡板数}
              onChange={(e) => setForm((f) => ({ ...f, 卡板数: e.target.value }))}
            />
          </FormField>
          <FormField label="领料备注">
            <SearchSelect
              ariaLabel="领料备注"
              disabled={readOnly}
              value={form.领料备注}
              options={ISSUE_REMARKS.map((v) => ({ value: v, label: v }))}
              onChange={(v) => setForm((f) => ({ ...f, 领料备注: v }))}
            />
          </FormField>
          <div className="col-span-2">
            <FormField label="备注">
              <Input
                className={inputCls}
                aria-label="备注"
                disabled={readOnly}
                value={form.备注}
                onChange={(e) => setForm((f) => ({ ...f, 备注: e.target.value }))}
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* 明细网格(列序对照老系统 PlasticWhitePartIssueLineTable;无价格列) */}
      <div className="f-panel overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "44vh" }}>
          <table data-freeze className="w-full min-w-[1350px] text-[15px]">
            <thead>
              <tr>
                {[
                  "发外采购",
                  "生产单号",
                  "款号",
                  "模具编号",
                  "物料编号",
                  "物料名称",
                  "颜色",
                  "用料名称",
                  "单位",
                  "数量",
                  "备注",
                  ...(readOnly ? [] : [""]),
                ].map((h, i) => (
                  <th key={i} className={cn(thCls, h === "数量" && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-sm text-disabled">
                    点「调入清单」按生产单带入,或「加一行」手录
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr key={i} className="border-b border-black/6 last:border-0">
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-24 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`发外采购 ${i + 1}`}
                        disabled={readOnly}
                        value={l.发外采购 ?? ""}
                        onChange={(e) => setLine(i, { 发外采购: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                          aria-label={`生产单号 ${i + 1}`}
                          disabled={readOnly}
                          value={l.生产单号 ?? ""}
                          onChange={(e) => setLine(i, { 生产单号: e.target.value })}
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            className="f-btn h-8 shrink-0 px-2 text-xs"
                            aria-label={`选生产单 ${i + 1}`}
                            onClick={() => setProdPickFor(i)}
                          >
                            选
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-24 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`款号 ${i + 1}`}
                        disabled={readOnly}
                        value={l.款号 ?? ""}
                        onChange={(e) => setLine(i, { 款号: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-24 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`模具编号 ${i + 1}`}
                        disabled={readOnly}
                        value={l.模具编号 ?? ""}
                        onChange={(e) => setLine(i, { 模具编号: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                          aria-label={`物料编号 ${i + 1}`}
                          disabled={readOnly}
                          value={l.物料编号 ?? ""}
                          onChange={(e) => setLine(i, { 物料编号: e.target.value })}
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            className="f-btn h-8 shrink-0 px-2 text-xs"
                            aria-label={`选物料 ${i + 1}`}
                            onClick={() => setMatPickFor(i)}
                          >
                            选
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{l.物料名称 ?? ""}</td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-16 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`颜色 ${i + 1}`}
                        disabled={readOnly}
                        value={l.颜色 ?? ""}
                        onChange={(e) => setLine(i, { 颜色: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`用料名称 ${i + 1}`}
                        disabled={readOnly}
                        value={l.用料名称 ?? ""}
                        onChange={(e) => setLine(i, { 用料名称: e.target.value })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-16 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`单位 ${i + 1}`}
                        disabled={readOnly}
                        value={l.单位 ?? ""}
                        onChange={(e) => setLine(i, { 单位: e.target.value })}
                      />
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-20 border-black/10 bg-black/[0.04] text-right text-sm"
                        aria-label={`数量 ${i + 1}`}
                        disabled={readOnly}
                        value={l.数量 ?? 0}
                        onChange={(e) => setLine(i, { 数量: Number(e.target.value) })}
                      />
                    </td>
                    <td className={cellCls}>
                      <Input
                        className="h-8 w-28 border-black/10 bg-black/[0.04] text-sm"
                        aria-label={`行备注 ${i + 1}`}
                        disabled={readOnly}
                        value={l.备注 ?? ""}
                        onChange={(e) => setLine(i, { 备注: e.target.value })}
                      />
                    </td>
                    {!readOnly && (
                      <td className={cn(cellCls, "text-center")}>
                        <button
                          type="button"
                          className="text-sm text-[#dc2626] hover:underline"
                          aria-label={`删除行 ${i + 1}`}
                          onClick={() =>
                            setLinesShown((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          删除
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="border-t border-black/8 px-4 py-3">
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              onClick={() => setLines((prev) => [...prev, { 数量: 0 }])}
            >
              加一行
            </button>
          </div>
        )}
        <div className="f-mono flex shrink-0 items-center gap-8 border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>
            数量合计 <b className="text-[#1a2330]">{数量合计}</b>
          </span>
          <span>
            制单人 <b className="text-[#1a2330]">{currentUser()}</b>
          </span>
        </div>
      </div>

      {/* 单据列表(对照老系统下方 Table:点单号查看;行内三级流转操作) */}
      <div className="f-panel overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "40vh" }}>
          <table data-freeze className="w-full min-w-[1000px] text-[15px]">
            <thead>
              <tr>
                {["单号", "领料部门", "领料人", "数量", "日期", "状态", "操作"].map((h) => (
                  <th key={h} className={cn(thCls, h === "数量" && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listQuery.isError ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-[#dc2626]">
                    加载白件领料单失败
                  </td>
                </tr>
              ) : listRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-disabled">
                    暂无单据
                  </td>
                </tr>
              ) : (
                listRows.map((row) => {
                  const [badgeCls, badgeText] = chainBadge(row);
                  return (
                    <tr key={row.id ?? row.单号} className="border-b border-black/6 last:border-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="f-mono font-semibold whitespace-nowrap text-[#15803d] hover:underline"
                          onClick={() => void openDoc(row.单号!)}
                        >
                          {row.单号}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{row.领料部门 ?? ""}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{row.领料人 ?? ""}</td>
                      <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                        {row.数量 ?? ""}
                      </td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {d10(row.日期)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                            badgeCls,
                          )}
                        >
                          {badgeText}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-wrap gap-3 text-sm">
                          {row.审核 !== "1" && row.主管审核 !== "1" && can(MENU, "审核") && (
                            <button
                              type="button"
                              className="text-[#15803d] hover:underline"
                              onClick={() =>
                                void act(
                                  () => plasticWhitePartIssueApi.supervisorApprove(row.单号!),
                                  "主管已审核",
                                )
                              }
                            >
                              主管审核
                            </button>
                          )}
                          {row.审核 !== "1" &&
                            row.主管审核 === "1" &&
                            row.经理审核 !== "1" &&
                            can(MENU, "审核") && (
                              <button
                                type="button"
                                className="text-[#15803d] hover:underline"
                                onClick={() =>
                                  void act(
                                    () => plasticWhitePartIssueApi.managerApprove(row.单号!),
                                    "经理已审核",
                                  )
                                }
                              >
                                经理审核
                              </button>
                            )}
                          {row.审核 !== "1" && row.经理审核 === "1" && can(MENU, "审核") && (
                            <button
                              type="button"
                              className="text-[#15803d] hover:underline"
                              onClick={() =>
                                void act(
                                  () => plasticWhitePartIssueApi.approve(row.单号!),
                                  "已审核",
                                )
                              }
                            >
                              审核(下发)
                            </button>
                          )}
                          {row.审核 === "1" && can(MENU, "反审核") && (
                            <button
                              type="button"
                              className="text-[#dc2626] hover:underline"
                              onClick={() =>
                                void act(
                                  () => plasticWhitePartIssueApi.unapprove(row.单号!),
                                  "已反审核",
                                )
                              }
                            >
                              反审核
                            </button>
                          )}
                          {row.审核 !== "1" && can(MENU, "删除") && (
                            <button
                              type="button"
                              className="text-[#dc2626] hover:underline"
                              onClick={() => setDeleteFor(row.单号!)}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {rows.length} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={listPage <= 1}
              onClick={() => setListPage((p) => p - 1)}
            >
              <CaretLeft className="h-4 w-4" />
              上一页
            </button>
            <span>
              {listPage} / {listTotalPages}
            </span>
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={listPage >= listTotalPages}
              onClick={() => setListPage((p) => p + 1)}
            >
              下一页
              <CaretRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      </div>

      <EmployeePickerDialog
        open={empOpen}
        onPick={(姓名) => setForm((f) => ({ ...f, 领料人: 姓名 }))}
        onClose={() => setEmpOpen(false)}
      />
      <ProductionPickerDialog
        open={prodOpen}
        onPick={(row) => void bringFromProduction(row.生产单号 ?? "")}
        onClose={() => setProdOpen(false)}
      />
      <PlasticMaterialPickerDialog
        open={matPickFor !== null}
        onPick={(m) => {
          if (matPickFor !== null)
            setLine(matPickFor, {
              物料编号: m.物料编号 ?? undefined,
              物料名称: m.物料名称 ?? undefined,
              颜色: m.颜色 ?? undefined,
            });
        }}
        onClose={() => setMatPickFor(null)}
      />
      <ProductionPickerDialog
        open={prodPickFor !== null}
        onPick={(row) => {
          if (prodPickFor !== null)
            setLine(prodPickFor, {
              生产单号: row.生产单号 ?? undefined,
              款号: row.款号 ?? undefined,
            });
        }}
        onClose={() => setProdPickFor(null)}
      />
      <ConfirmDialog
        open={deleteFor !== null}
        onClose={() => setDeleteFor(null)}
        title="确认删除该白件领料单?"
        confirmLabel="删除"
        onConfirm={() => {
          const no = deleteFor;
          setDeleteFor(null);
          if (no) void act(() => plasticWhitePartIssueApi.remove(no), "已删除");
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
