// 部门人事(/hr/department-personnel;老系统 web/src/pages/system/DepartmentPersonnelPage.tsx 重写):
// 左侧部门列表(全部部门(N) + 部门(人数);单击过滤,双击编辑,删除前本地算引用人数,有人仍允许删);
// 右侧人员网格(一次拉全量 2000,部门过滤/关键字(编号/姓名/职称)/部门名称 join 均在前端做,客户端分页 50/页);
// 双击行选中后编辑/删除;新增默认 在职 + 当前选中部门;编辑先 GET 详情预填;
// 日期字段(出生日期/入职日期/离职日期)以 YYYY-MM-DD 落库;基本工资受「人事档案·单价」位控制(无=显示 *** 且表单隐藏)。
// 权限菜单:人员=人事档案、部门=部门信息(MenuCatalog.cs:11-12 实证:基础资料组)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight, Pencil, Plus, Prohibit, Trash, X } from "@phosphor-icons/react";
import { masterDataApi } from "@/api/endpoints";
import type { MasterRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { cn } from "@/lib/utils";

const EMP_MENU = "人事档案"; // 人员权限菜单名
const DEPT_MENU = "部门信息"; // 部门权限菜单名
const ALL = "__ALL__"; // 左侧「全部部门」选项 key
const PAGE_SIZE = 50; // 客户端分页(对照老系统 pagination pageSize:50)

const departments = masterDataApi("departments");
const employees = masterDataApi("employees");
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

type Row = MasterRow & { ID: number };

// 人员日期字段(日期输入框编辑,保存时已为 YYYY-MM-DD)
const DATE_FIELDS = ["出生日期", "入职日期", "离职日期"] as const;

// 人员表单字段(对照老系统 Modal 的 Row/Col 布局;编号/姓名必填)
const TEXT_FIELDS: { name: string; label: string; required?: boolean; span2?: boolean; textarea?: boolean }[] = [
  { name: "自动编号", label: "自动编号" },
  { name: "编号", label: "编号", required: true },
  { name: "姓名", label: "姓名", required: true },
  { name: "职称", label: "职称" },
  { name: "考勤卡号", label: "考勤卡号" },
  { name: "电话", label: "电话" },
  { name: "手机", label: "手机" },
  { name: "工序类型", label: "工序类型" },
  { name: "默认班次", label: "默认班次" },
  { name: "身份证号", label: "身份证号", span2: true },
  { name: "地址", label: "地址", span2: true },
  { name: "备注", label: "备注", span2: true, textarea: true },
];

const dateCell = (v?: unknown) => (v ? String(v).slice(0, 10) : "");

export default function DepartmentPersonnelPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(EMP_MENU, "打开");
  const canSave = can(EMP_MENU, "保存");
  const canDelete = can(EMP_MENU, "删除");
  const canDeptSave = can(DEPT_MENU, "保存");
  const canDeptDelete = can(DEPT_MENU, "删除");
  // 无「单价」权限即隐藏基本工资(对照老系统 hidePrice)
  const priceHidden = !can(EMP_MENU, "单价");

  const [depts, setDepts] = useState<Row[]>([]);
  const [selDept, setSelDept] = useState<string>(ALL);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selRow, setSelRow] = useState<Row | null>(null);

  const [editing, setEditing] = useState<Row | null>(null); // null=不显示;ID=0 表示新增
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deptEditing, setDeptEditing] = useState<Row | null>(null); // null=关;ID=0=新增部门
  const [deptForm, setDeptForm] = useState({ 编号: "", 部门: "", 备注: "" });
  const [deptSaving, setDeptSaving] = useState(false);

  const [delEmpOpen, setDelEmpOpen] = useState(false);
  const [delDept, setDelDept] = useState<Row | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const loadDepts = useCallback(async () => {
    try {
      const r = await departments.list(1, 500);
      setDepts(r.items.map((x) => ({ ...x, ID: Number(x.ID ?? x.id ?? 0) })));
    } catch {
      /* 无部门权限等:左侧列表留空,人员区仍可用 */
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      // 一次拉全量,部门过滤/关键字搜索均在前端做(部门名称也要前端 join)
      const r = await employees.list(1, 2000);
      setRows(r.items.map((x) => ({ ...x, ID: Number(x.ID ?? x.id ?? 0) })));
      setSelRow(null);
    } catch (e) {
      setToast({ text: errMsg(e, "加载人员失败"), tone: "err" });
    } finally {
      setLoading(false);
    }
  }, [canOpen]);

  useEffect(() => {
    if (!canOpen) return;
    // 微任务里拉取:setState 不在 effect 同步路径
    void Promise.resolve().then(async () => {
      await loadDepts();
      await loadRows();
    });
  }, [canOpen, loadDepts, loadRows]);

  // 部门编号 -> 部门名称 映射(人员.部门编号 -> 部门.部门)
  const deptNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of depts) {
      const code = String(d.编号 ?? "");
      if (code) m.set(code, String(d.部门 ?? ""));
    }
    return m;
  }, [depts]);

  // 每个部门的人数(左侧名称后括号展示、删除前引用检查均用本地数据)
  const countByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const code = String(r.部门编号 ?? "");
      if (code) m.set(code, (m.get(code) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  // 右侧人员:按选中部门 + 关键字(编号/姓名/职称)前端过滤
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (selDept !== ALL && String(r.部门编号 ?? "") !== selDept) return false;
      if (!kw) return true;
      return [r.编号, r.姓名, r.职称].some((v) => String(v ?? "").toLowerCase().includes(kw));
    });
  }, [rows, selDept, keyword]);

  // 切部门/改关键字时同步重置页码(在事件处理器里一并 setState,不用 effect)
  const selectDept = (code: string) => {
    setSelDept(code);
    setPage(1);
  };
  const changeKeyword = (v: string) => {
    setKeyword(v);
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing({ ID: 0 });
    // 新增默认:在职;部门默认带当前左侧选中部门
    setForm({ 在职: "在职", 部门编号: selDept === ALL ? "" : selDept });
  };
  const openEdit = async (r: Row) => {
    try {
      const full = await employees.get(r.ID);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(full)) {
        if (val == null) continue;
        v[k] = DATE_FIELDS.includes(k as (typeof DATE_FIELDS)[number])
          ? String(val).slice(0, 10)
          : String(val);
      }
      setEditing(r);
      setForm(v);
    } catch (e) {
      setToast({ text: errMsg(e, "加载人员详情失败"), tone: "err" });
    }
  };

  const submit = async () => {
    if (!editing) return;
    if (!form.编号?.trim()) {
      setToast({ text: "请输入编号", tone: "err" });
      return;
    }
    if (!form.姓名?.trim()) {
      setToast({ text: "请输入姓名", tone: "err" });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      for (const f of DATE_FIELDS) body[f] = form[f] || null;
      if (editing.ID > 0) await employees.update(editing.ID, body);
      else await employees.create(body);
      setToast({ text: "已保存", tone: "ok" });
      setEditing(null);
      setSelRow(null);
      await loadDepts();
      await loadRows();
    } catch (e) {
      setToast({ text: errMsg(e, "保存失败"), tone: "err" });
    } finally {
      setSaving(false);
    }
  };

  const delEmp = async () => {
    if (!selRow) return;
    try {
      await employees.remove(selRow.ID);
      setToast({ text: "已删除", tone: "ok" });
      setDelEmpOpen(false);
      setSelRow(null);
      await loadDepts();
      await loadRows();
    } catch (e) {
      setToast({ text: errMsg(e, "删除失败"), tone: "err" });
      setDelEmpOpen(false);
    }
  };

  // 部门新增/编辑(编辑时编号锁定:人员按 部门编号 引用,改编号会让人员失联)
  const openDeptCreate = () => {
    setDeptEditing({ ID: 0 });
    setDeptForm({ 编号: "", 部门: "", 备注: "" });
  };
  const openDeptEdit = async (d: Row) => {
    try {
      const full = await departments.get(d.ID);
      setDeptEditing(d);
      setDeptForm({
        编号: String(full.编号 ?? ""),
        部门: String(full.部门 ?? ""),
        备注: String(full.备注 ?? ""),
      });
    } catch (e) {
      setToast({ text: errMsg(e, "加载部门详情失败"), tone: "err" });
    }
  };
  const submitDept = async () => {
    if (!deptEditing) return;
    if (!deptForm.编号.trim()) {
      setToast({ text: "请输入编号", tone: "err" });
      return;
    }
    if (!deptForm.部门.trim()) {
      setToast({ text: "请输入部门名称", tone: "err" });
      return;
    }
    setDeptSaving(true);
    try {
      if (deptEditing.ID > 0) {
        await departments.update(deptEditing.ID, { ...deptForm, 编号: String(deptEditing.编号 ?? "") });
      } else {
        await departments.create(deptForm);
      }
      setToast({ text: "部门已保存", tone: "ok" });
      setDeptEditing(null);
      await loadDepts();
    } catch (e) {
      setToast({ text: errMsg(e, "部门保存失败"), tone: "err" });
    } finally {
      setDeptSaving(false);
    }
  };

  // 删除部门:有人员时确认弹窗里给出引用人数警告,但仍允许删(对照老系统 message.warning + 照删)
  const confirmDelDept = async () => {
    if (!delDept) return;
    try {
      await departments.remove(delDept.ID);
      setToast({ text: "部门已删除", tone: "ok" });
      if (selDept === String(delDept.编号 ?? "")) selectDept(ALL);
      setDelDept(null);
      await loadDepts();
      await loadRows();
    } catch (e) {
      setToast({ text: errMsg(e, "部门删除失败"), tone: "err" });
      setDelDept(null);
    }
  };

  const money = (v?: unknown) => (priceHidden ? "***" : v == null || v === "" ? "" : String(v));

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「人事档案·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  const GRID_COLS: { title: string; key: string; mono?: boolean; right?: boolean; date?: boolean; money?: boolean; deptName?: boolean }[] = [
    // 旧系统固定列顺序:部门编号|部门名称|自动编号|编号|姓名|性别|职称|电话|手机|地址|身份证号|出生日期|入职日期|离职日期|基本工资|备注|在职
    { title: "部门编号", key: "部门编号", mono: true },
    { title: "部门名称", key: "部门编号", deptName: true },
    { title: "自动编号", key: "自动编号", mono: true },
    { title: "编号", key: "编号", mono: true },
    { title: "姓名", key: "姓名" },
    { title: "性别", key: "性别" },
    { title: "职称", key: "职称" },
    { title: "电话", key: "电话", mono: true },
    { title: "手机", key: "手机", mono: true },
    { title: "地址", key: "地址" },
    { title: "身份证号", key: "身份证号", mono: true },
    { title: "出生日期", key: "出生日期", date: true },
    { title: "入职日期", key: "入职日期", date: true },
    { title: "离职日期", key: "离职日期", date: true },
    { title: "基本工资", key: "基本工资", right: true, money: true },
    { title: "备注", key: "备注" },
    { title: "在职", key: "在职" },
  ];

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">部门人事</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <input
            aria-label="搜索人员"
            className="f-input f-input-slim w-56"
            placeholder="编号/姓名/职称"
            value={keyword}
            onChange={(e) => changeKeyword(e.target.value)}
          />
          {canSave && (
            <button type="button" className="f-btn f-btn-cyan h-9 px-4 text-sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增
            </button>
          )}
          {canSave && (
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              disabled={!selRow}
              onClick={() => selRow && void openEdit(selRow)}
            >
              <Pencil className="h-4 w-4" />
              编辑
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm text-[#dc2626]"
              disabled={!selRow}
              onClick={() => setDelEmpOpen(true)}
            >
              <Trash className="h-4 w-4" />
              删除
            </button>
          )}
          <span className={cn("text-xs", selRow ? "text-[#1d4ed8]" : "text-disabled")}>
            {selRow
              ? `已选中:${String(selRow.编号 ?? "")} ${String(selRow.姓名 ?? "")}`
              : "双击行选中后可编辑/删除"}
          </span>
        </div>
      </div>

      <div className="f-panel flex gap-3 p-4">
        {/* 左:部门列表 */}
        <div className="w-56 shrink-0 border-r border-black/8 pr-3">
          {canDeptSave && (
            <button type="button" className="f-btn mb-2 h-8 px-2.5 text-xs" onClick={openDeptCreate}>
              <Plus className="h-3.5 w-3.5" />
              新增部门
            </button>
          )}
          {canDeptSave && <div className="mb-1.5 text-[11px] text-disabled">双击部门名称可编辑</div>}
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              selDept === ALL
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#3d4a5c] hover:bg-black/[0.04]",
            )}
            onClick={() => selectDept(ALL)}
          >
            全部部门({rows.length})
          </button>
          {depts.map((d) => {
            const code = String(d.编号 ?? "");
            const name = String(d.部门 ?? "");
            return (
              <div
                key={d.ID}
                className={cn(
                  "group flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors",
                  selDept === code
                    ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                    : "text-[#3d4a5c] hover:bg-black/[0.04]",
                )}
                onClick={() => selectDept(code)}
                onDoubleClick={() => {
                  if (canDeptSave) void openDeptEdit(d);
                }}
                title={canDeptSave ? "双击编辑该部门" : undefined}
              >
                <span className="truncate">
                  {name}({countByDept.get(code) ?? 0})
                </span>
                {canDeptDelete && (
                  <button
                    type="button"
                    aria-label={`删除部门 ${name}`}
                    className="ml-1 shrink-0 text-[#dc2626]/70 hover:text-[#dc2626]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDelDept(d);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* 右:人员网格 */}
        <div className="min-w-0 flex-1">
          <div className="max-h-[62vh] overflow-auto rounded-lg border border-black/8">
            <table data-freeze className="w-full text-sm" style={{ minWidth: 1600 }}>
              <thead>
                <tr>
                  {GRID_COLS.map((c) => (
                    <th
                      key={c.title}
                      className={cn(
                        "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 font-medium whitespace-nowrap normal-case",
                        c.right ? "text-right" : "text-left",
                      )}
                    >
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={GRID_COLS.length} className="px-4 py-10 text-center text-disabled">
                      {loading ? "加载中..." : "暂无数据"}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr
                      key={r.ID}
                      className={cn(
                        "cursor-pointer border-b border-black/6 hover:bg-black/[0.04]",
                        selRow?.ID === r.ID && "bg-[#2563eb]/8",
                      )}
                      onDoubleClick={() => setSelRow(r)}
                    >
                      {GRID_COLS.map((c) => {
                        const raw = r[c.key];
                        const text = c.deptName
                          ? (deptNameByCode.get(String(raw ?? "")) ?? "")
                          : c.date
                            ? dateCell(raw)
                            : c.money
                              ? money(raw)
                              : String(raw ?? "");
                        return (
                          <td
                            key={c.title}
                            className={cn(
                              "max-w-44 truncate px-3 py-2 whitespace-nowrap",
                              c.mono && "f-mono",
                              c.right && "text-right",
                            )}
                            title={text}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="f-mono mt-2 flex items-center justify-between px-1 text-sm text-[#5f6b7d]">
            <span>共 {filtered.length} 条</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                aria-label="上一页"
                className="f-btn h-7 w-7"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <CaretLeft className="h-3.5 w-3.5" />
              </button>
              {page} / {pages}
              <button
                type="button"
                aria-label="下一页"
                className="f-btn h-7 w-7"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <CaretRight className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* 人员表单(新增/编辑;对照老系统 Modal 760px 三栏) */}
      <PickerDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && editing.ID > 0 ? "编辑人员" : "新增人员"}
        width="sm:max-w-[760px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={saving}
              onClick={() => void submit()}
            >
              确定
            </button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
          {TEXT_FIELDS.slice(0, 3).map((f) => (
            <label key={f.name} className="block">
              <span className="f-label">
                {f.label}
                {f.required && <span className="text-[#dc2626]"> *</span>}
              </span>
              <input
                aria-label={f.label}
                className="f-input f-input-slim mt-1.5"
                value={form[f.name] ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
          <label className="block">
            <span className="f-label">性别</span>
            <SearchSelect
              ariaLabel="性别"
              className="mt-1.5"
              value={form.性别 ?? ""}
              options={["男", "女"].map((v) => ({ value: v, label: v }))}
              placeholder="请选择"
              clearLabel="请选择"
              onChange={(v) => setForm((f) => ({ ...f, 性别: v }))}
            />
          </label>
          <label className="block">
            <span className="f-label">部门编号</span>
            <SearchSelect
              ariaLabel="部门编号"
              className="mt-1.5"
              value={form.部门编号 ?? ""}
              options={depts.map((d) => ({
                value: String(d.编号 ?? ""),
                label: [String(d.编号 ?? ""), String(d.部门 ?? "")].filter(Boolean).join(" "),
              }))}
              placeholder="请选择"
              clearLabel="请选择"
              onChange={(v) => setForm((f) => ({ ...f, 部门编号: v }))}
            />
          </label>
          {TEXT_FIELDS.slice(3, 9).map((f) => (
            <label key={f.name} className="block">
              <span className="f-label">{f.label}</span>
              <input
                aria-label={f.label}
                className="f-input f-input-slim mt-1.5"
                value={form[f.name] ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
          {DATE_FIELDS.map((f) => (
            <label key={f} className="block">
              <span className="f-label">{f}</span>
              <input
                aria-label={f}
                type="date"
                className="f-input f-input-slim mt-1.5"
                value={form[f] ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, [f]: e.target.value }))}
              />
            </label>
          ))}
          {!priceHidden && (
            <label className="block">
              <span className="f-label">基本工资</span>
              <input
                aria-label="基本工资"
                type="number"
                min={0}
                className="f-input f-input-slim mt-1.5"
                value={form.基本工资 ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, 基本工资: e.target.value }))}
              />
            </label>
          )}
          <label className="block">
            <span className="f-label">在职</span>
            <SearchSelect
              ariaLabel="在职"
              className="mt-1.5"
              value={form.在职 ?? "在职"}
              options={["在职", "离职"].map((v) => ({ value: v, label: v }))}
              onChange={(v) => setForm((f) => ({ ...f, 在职: v }))}
            />
          </label>
          {TEXT_FIELDS.slice(9).map((f) => (
            <label key={f.name} className={cn("block", f.span2 && "col-span-3")}>
              <span className="f-label">{f.label}</span>
              {f.textarea ? (
                <textarea
                  aria-label={f.label}
                  rows={2}
                  className="f-input mt-1.5 h-auto w-full py-2"
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              ) : (
                <input
                  aria-label={f.label}
                  className="f-input f-input-slim mt-1.5"
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      </PickerDialog>

      {/* 部门弹窗(新增/编辑;编辑时编号锁定) */}
      <PickerDialog
        open={deptEditing !== null}
        onClose={() => setDeptEditing(null)}
        title={deptEditing && deptEditing.ID > 0 ? "编辑部门" : "新增部门"}
        width="sm:max-w-[420px]"
        footer={
          <>
            <button type="button" className="f-btn h-10 px-4" onClick={() => setDeptEditing(null)}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={deptSaving}
              onClick={() => void submitDept()}
            >
              确定
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="f-label">
              编号<span className="text-[#dc2626]"> *</span>
            </span>
            <input
              aria-label="部门编号"
              className="f-input f-input-slim mt-1.5"
              disabled={!!deptEditing && deptEditing.ID > 0}
              placeholder={deptEditing && deptEditing.ID > 0 ? "编号被人员引用,不可修改" : undefined}
              value={deptForm.编号}
              onChange={(e) => setDeptForm((v) => ({ ...v, 编号: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="f-label">
              部门<span className="text-[#dc2626]"> *</span>
            </span>
            <input
              aria-label="部门名称"
              className="f-input f-input-slim mt-1.5"
              value={deptForm.部门}
              onChange={(e) => setDeptForm((v) => ({ ...v, 部门: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="f-label">备注</span>
            <textarea
              aria-label="部门备注"
              rows={2}
              className="f-input mt-1.5 h-auto w-full py-2"
              value={deptForm.备注}
              onChange={(e) => setDeptForm((v) => ({ ...v, 备注: e.target.value }))}
            />
          </label>
        </div>
      </PickerDialog>

      <ConfirmDialog
        open={delEmpOpen}
        onClose={() => setDelEmpOpen(false)}
        title={`确认删除人员${selRow ? ` ${String(selRow.编号 ?? "")} ${String(selRow.姓名 ?? "")}` : ""}?`}
        onConfirm={() => void delEmp()}
      />
      <ConfirmDialog
        open={delDept !== null}
        onClose={() => setDelDept(null)}
        title={`确认删除部门 ${delDept ? String(delDept.部门 ?? "") : ""}?`}
        description={
          delDept && (countByDept.get(String(delDept.编号 ?? "")) ?? 0) > 0
            ? `该部门下还有 ${countByDept.get(String(delDept.编号 ?? ""))} 名人员`
            : undefined
        }
        onConfirm={() => void confirmDelDept()}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
