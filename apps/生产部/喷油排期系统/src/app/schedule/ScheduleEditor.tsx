"use client";
import { apiFetch } from "@/lib/apiFetch";
// 排期录入客户端组件：三卡片结构，照 docs/preview/schedule-entry-preview-v1.html 实现。
// 表格列：选择｜子件｜部位｜部位总需求｜标准日产能｜指派机台｜人数｜今日计划生产数
// 机喷(machine)部位显示机台标签；人工喷(manual)部位机台列显「—」，不能选机台
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SchedulablePart } from "@/lib/schedule";
import { lineLabel } from "@/lib/line";
import DatePicker from "@/app/orders/DatePicker";

// ===== 类型定义 =====
type Machine = { id: number; machineNo: string; isUV: boolean };
type Line = {
  id: number;
  name: string;
  workshop: string;
  leaderName: string | null;
  machines: Machine[];
};
type OrderLite = {
  id: number;
  externalOrderNo: string;
  productNo: string;
  isMA: boolean;
  parts: SchedulablePart[];
};
// 每个「订单×部位」组合的录入表单状态
type PartForm = {
  checked: boolean;
  machineNos: string[];
  workerCount: number | "";
  plannedQty: number | "";
};

// ===== 工具函数 =====
/** 数字千位分隔符显示（只显示，不影响逻辑值） */
function fmt(n: number) {
  return n.toLocaleString("zh-CN");
}

export default function ScheduleEditor({
  lines,
  orders,
}: {
  lines: Line[];
  orders: OrderLite[];
}) {
  const router = useRouter();

  // ===== 全局表单状态 =====
  const [planDate, setPlanDate] = useState<string>("");
  const [lineId, setLineId] = useState<number | null>(lines[0]?.id ?? null);
  // 展开的订单 Set（订单 id）
  const [openOrders, setOpenOrders] = useState<Set<number>>(new Set());
  // 每个「oid:pid」的表单状态
  const [forms, setForms] = useState<Record<string, PartForm>>({});
  const [saving, setSaving] = useState(false);
  // 用户点过「保存」但因非法计划数被拦截时置 true，触发飘红提示；成功保存后重置为 false
  const [triedSave, setTriedSave] = useState(false);
  // 当前正在编辑机台指派的部位行 key（格式：`${orderId}:${sourcePartId}`），null 表示未进入编辑状态
  const [activeMachineKey, setActiveMachineKey] = useState<string | null>(null);
  // 已排键集合：存该「日期+拉别」下已排的 `${orderId}:${sourcePartId}`，用于置灰防重
  const [scheduledKeys, setScheduledKeys] = useState<Set<string>>(new Set());

  // ===== 防重：按 planDate + lineId 双条件拉取已排部位 =====
  useEffect(() => {
    if (!planDate || !lineId) {
      // 任一条件为空 → 清空防重集合
      setScheduledKeys(new Set());
      return;
    }
    // 拉取该「日期+拉别」已排计划行
    apiFetch(`/api/plans?planDate=${planDate}&lineId=${lineId}`)
      .then((res) => res.json())
      .then((rows: { orderId: number; sourcePartId: number }[]) => {
        setScheduledKeys(new Set(rows.map((r) => `${r.orderId}:${r.sourcePartId}`)));
      })
      .catch(() => {
        // fetch 失败 → 置空集合，不阻断用户操作
        setScheduledKeys(new Set());
      });
  }, [planDate, lineId]);

  // ===== 派生数据 =====
  const line = lines.find((l) => l.id === lineId) ?? null;

  // 复合键：订单id:部位id
  const key = (oid: number, pid: number) => `${oid}:${pid}`;

  const getForm = (oid: number, pid: number): PartForm =>
    forms[key(oid, pid)] ?? { checked: false, machineNos: [], workerCount: "", plannedQty: "" };

  const setForm = (oid: number, pid: number, patch: Partial<PartForm>) =>
    setForms((f) => ({ ...f, [key(oid, pid)]: { ...getForm(oid, pid), ...patch } }));

  // 切换机台选中/取消
  const toggleMachine = (oid: number, pid: number, no: string) => {
    const cur = getForm(oid, pid).machineNos;
    setForm(oid, pid, {
      machineNos: cur.includes(no) ? cur.filter((x) => x !== no) : [...cur, no],
    });
  };

  // 折叠/展开订单行
  const toggleOrder = (oid: number) =>
    setOpenOrders((s) => {
      const n = new Set(s);
      n.has(oid) ? n.delete(oid) : n.add(oid);
      return n;
    });

  // 勾选/取消整张订单所有部位
  const toggleOrderCheck = (oid: number, checked: boolean, parts: SchedulablePart[]) => {
    setForms((f) => {
      const next = { ...f };
      for (const pt of parts) {
        const k = key(oid, pt.sourcePartId);
        next[k] = { ...(next[k] ?? { machineNos: [], workerCount: "", plannedQty: "" }), checked };
      }
      return next;
    });
    // 勾选时自动展开
    if (checked) setOpenOrders((s) => new Set(s).add(oid));
  };

  // 计算已勾选部位数（用于底部摘要）
  const checkedCount = Object.values(forms).filter((f) => f.checked).length;

  // 从 activeMachineKey 中解析出 orderId 和 sourcePartId，用于第二步状态提示文字
  // 格式：`${orderId}:${sourcePartId}`
  const activeKeyParts = activeMachineKey ? activeMachineKey.split(":") : null;
  const activeOrderId = activeKeyParts ? Number(activeKeyParts[0]) : null;
  const activeSourcePartId = activeKeyParts ? Number(activeKeyParts[1]) : null;

  // 找到正在编辑行的子件/部位名称，用于第二步提示文字
  let activeLabel = "";
  if (activeOrderId !== null && activeSourcePartId !== null) {
    for (const o of orders) {
      if (o.id === activeOrderId) {
        const pt = o.parts.find((p) => p.sourcePartId === activeSourcePartId);
        if (pt) {
          activeLabel = `${pt.itemName} · ${pt.partName}`;
        }
        break;
      }
    }
  }

  // ===== 保存逻辑 =====
  async function save() {
    // 前置条件校验（无法用飘红表达，保留 alert）
    if (!planDate || !lineId) {
      alert("请先选择生产日期和拉别");
      return;
    }

    // 标记「曾尝试保存」，触发计划数输入框飘红
    setTriedSave(true);

    const plans: {
      planDate: string;
      planType: string;
      lineId: number;
      orderId: number;
      itemName: string;
      partName: string;
      sourcePartId: number;
      machineNos: string[];
      plannedQty: number;
      workerCount: number;
    }[] = [];

    // 收集所有「勾中但计划数空/≤0」的非法行
    let hasInvalid = false;
    for (const o of orders) {
      for (const pt of o.parts) {
        const fm = getForm(o.id, pt.sourcePartId);
        if (!fm.checked) continue;
        // 防重防御：跳过已排部位（理论上 UI 已禁用勾选，双保险）
        if (scheduledKeys.has(`${o.id}:${pt.sourcePartId}`)) continue;
        const qty = Number(fm.plannedQty);
        if (!qty || qty <= 0) {
          // 有非法行：不弹 alert，靠输入框飘红提示用户
          hasInvalid = true;
        } else {
          plans.push({
            planDate,
            planType: "daily",
            lineId: lineId!,
            orderId: o.id,
            itemName: pt.itemName,
            partName: pt.partName,
            sourcePartId: pt.sourcePartId,
            machineNos: fm.machineNos,
            plannedQty: qty,
            workerCount: Number(fm.workerCount) || 1,
          });
        }
      }
    }

    // 有非法计划数 → 中止提交（飘红已在输入框渲染时体现）
    if (hasInvalid) return;

    if (plans.length === 0) {
      alert("请至少勾选一个部位并填计划数");
      return;
    }

    setSaving(true);
    const res = await apiFetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plans }),
    });
    setSaving(false);

    if (res.ok) {
      alert("排期已保存，生成待录单");
      router.refresh();
      setForms({});
      setOpenOrders(new Set());
      setTriedSave(false); // 成功后重置，避免下次录入时残留飘红
    } else {
      const e = await res.json().catch(() => ({}));
      alert("保存失败：" + (e.error ?? res.status));
    }
  }

  // ===== 渲染 =====
  return (
    <div className="max-w-[1480px] mx-auto">
      {/* 页面标题 */}
      <div className="mb-1">
        {/* 标题行：仅标题（甘特图入口已移到仪表盘） */}
        <h1 className="text-[22px] font-bold text-[#333333]">排期录入</h1>
        <p className="text-[13px] text-[#999999] mt-1">
          把车间主管 / 拉长安排好的生产计划敲进系统 —— 保存后即生成「待录单」，次日补填实际生产数。系统只记录、不替你排产。
        </p>
      </div>

      {/* ===== 卡片 1：选日期、拉别 → 该拉别机台（点选操作区） ===== */}
      <div className="bg-white border border-[#E0E0E0] rounded-[10px] px-5 py-[18px] mb-[18px]">
        <div className="flex items-center gap-2 mb-4 font-bold text-[15px] text-[#333333]">
          <span className="inline-flex w-[22px] h-[22px] rounded-full bg-[#047857] text-white text-[13px] items-center justify-center shrink-0">
            1
          </span>
          选日期、拉别 → 该拉别机台
        </div>

        {/* 生产日期 + 拉别下拉 */}
        <div className="flex flex-wrap items-center gap-6 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#999999]">生产日期</span>
            <DatePicker value={planDate} onChange={setPlanDate} placeholder="选择日期" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#999999]">拉别</span>
            <select
              value={lineId ?? ""}
              onChange={(e) => setLineId(Number(e.target.value))}
              className="border border-[#E0E0E0] rounded-[6px] px-[10px] py-[7px] text-[14px] text-[#333333] bg-white w-[220px]"
            >
              {lines.map((l) => (
                <option key={l.id} value={l.id}>{lineLabel(l)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 机台标签点选操作区 */}
        {line && line.machines.length > 0 && (
          <>
            {/* 状态提示文字：根据是否处于编辑中显示不同文案 */}
            <p className="text-[12px] mb-2">
              {activeMachineKey ? (
                <span className="text-[#047857] font-medium">
                  正在为「{activeLabel}」选机台（绿色=已选，再点一次取消）
                </span>
              ) : (
                <span className="text-[#999999]">
                  先点下方部位行的机台框，再回这里点机台标签完成指派
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-[10px] mt-1">
              {line.machines.map((m) => {
                // 判断该机台是否已加入当前编辑行的 machineNos
                const isSelected =
                  activeMachineKey !== null &&
                  (() => {
                    const parts = activeMachineKey.split(":");
                    const oid = Number(parts[0]);
                    const pid = Number(parts[1]);
                    return getForm(oid, pid).machineNos.includes(m.machineNo);
                  })();

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      // 有编辑中的行 → 切换该机台；否则无效（提示已在状态文字中给出）
                      if (activeMachineKey !== null) {
                        const parts = activeMachineKey.split(":");
                        const oid = Number(parts[0]);
                        const pid = Number(parts[1]);
                        toggleMachine(oid, pid, m.machineNo);
                      }
                    }}
                    className={`rounded-[20px] px-4 py-[6px] text-[13px] select-none transition-colors ${
                      activeMachineKey === null
                        ? // 未进入编辑态：普通展示，鼠标默认
                          m.isUV
                          ? "border border-dashed border-[#E0E0E0] bg-white text-[#333333] cursor-default"
                          : "border border-[#E0E0E0] bg-white text-[#333333] cursor-default"
                        : isSelected
                        ? // 编辑态且已选中：绿色实心高亮
                          "bg-[#34d399] text-white border border-[#34d399] cursor-pointer"
                        : // 编辑态但未选中：可点选
                          m.isUV
                          ? "border border-dashed border-[#E0E0E0] bg-white text-[#333333] cursor-pointer hover:border-[#047857] hover:text-[#047857]"
                          : "border border-[#E0E0E0] bg-white text-[#333333] cursor-pointer hover:border-[#047857] hover:text-[#047857]"
                    }`}
                  >
                    {m.machineNo}
                    {m.isUV ? " UV" : ""}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {line && line.machines.length === 0 && (
          <p className="text-[13px] text-[#999999]">该拉别暂无已录入机台。</p>
        )}
        {!line && (
          <p className="text-[13px] text-[#999999]">请先选择拉别。</p>
        )}
      </div>

      {/* ===== 卡片 2：勾订单 → 排部位 ===== */}
      <div className="bg-white border border-[#E0E0E0] rounded-[10px] px-5 py-[18px] mb-[18px]">
        <div className="flex items-center gap-2 mb-1 font-bold text-[15px] text-[#333333]">
          <span className="inline-flex w-[22px] h-[22px] rounded-full bg-[#047857] text-white text-[13px] items-center justify-center shrink-0">
            2
          </span>
          勾订单 → 排部位（填今天计划生产数）
        </div>
        {/* 防重提示：选定日期+拉别后自动生效 */}
        <p className="text-[12px] text-[#999999] mb-3">
          选定日期 + 拉别后，该组合下已排过的部位会置灰、不可重复排
        </p>

        {orders.length === 0 && (
          <p className="text-[13px] text-[#999999] py-4 text-center">
            暂无状态为「已接单 / 排期中 / 生产中」的订单
          </p>
        )}

        {orders.map((o) => {
          const isOpen = openOrders.has(o.id);
          // 判断订单是否全部勾选（有部位时才判断）
          const allChecked =
            o.parts.length > 0 &&
            o.parts.every((pt) => getForm(o.id, pt.sourcePartId).checked);
          const someChecked =
            o.parts.some((pt) => getForm(o.id, pt.sourcePartId).checked);

          return (
            <div
              key={o.id}
              className="border border-[#E0E0E0] rounded-[8px] mb-3 overflow-hidden"
            >
              {/* 订单行头部 */}
              <div
                className="flex items-center gap-3 px-[14px] py-3 bg-[#fafbff] cursor-pointer select-none"
                onClick={() => toggleOrder(o.id)}
              >
                {/* 全选复选框（阻止点击冒泡到折叠） */}
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleOrderCheck(o.id, e.target.checked, o.parts);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-[15px] h-[15px] cursor-pointer"
                />
                <span className="font-mono font-bold text-[#047857]">
                  {o.externalOrderNo}
                </span>
                <span className="text-[#333333] text-[14px]">
                  款号 {o.productNo}
                </span>
                {o.isMA && (
                  <span className="bg-[#FFF3CD] text-[#8A6D1A] text-[11px] px-[7px] py-[2px] rounded-[4px] font-bold">
                    MA
                  </span>
                )}
                <span className="ml-auto text-[12px] text-[#999999]">
                  {isOpen ? "▾ 已展开" : "▸ 点击展开"}
                </span>
              </div>

              {/* 部位表（展开时显示） */}
              {isOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13.5px]">
                    <thead>
                      <tr>
                        {/* 选择列 */}
                        <th className="bg-[#f0fdf4] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5] w-[42px]" />
                        {/* 子件 */}
                        <th className="bg-[#f0fdf4] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          子件
                        </th>
                        {/* 部位 */}
                        <th className="bg-[#f0fdf4] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          部位
                        </th>
                        {/* 部位总需求（计算字段，浅天青） */}
                        <th className="bg-[#d1fae5] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          部位总需求
                          <span className="text-[11px] text-[#2f8f6e] font-normal ml-1">
                            （接单部位数量）
                          </span>
                        </th>
                        {/* 标准日产能（计算字段） */}
                        <th className="bg-[#d1fae5] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          标准日产能
                        </th>
                        {/* 指派机台 */}
                        <th className="bg-[#f0fdf4] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          指派机台
                        </th>
                        {/* 人数 */}
                        <th className="bg-[#f0fdf4] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          人数
                        </th>
                        {/* 今日计划生产数 */}
                        <th className="bg-[#f0fdf4] text-[#047857] font-bold px-3 py-[10px] text-left text-[13px] border-b border-[#d1fae5]">
                          今日计划生产数
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.parts.map((pt, idx) => {
                        const fm = getForm(o.id, pt.sourcePartId);
                        const isMachine = pt.productionMode === "machine";
                        const qtyNum = Number(fm.plannedQty);
                        // 飘红条件：用户点过保存 + 该行已勾选 + 计划数空或非正数
                        const qtyBad =
                          triedSave && fm.checked && (!qtyNum || qtyNum <= 0);
                        // 该行的复合键
                        const rowKey = key(o.id, pt.sourcePartId);
                        // 是否正在编辑该行机台
                        const isActiveRow = activeMachineKey === rowKey;
                        // 防重：该「日期+拉别」下此部位是否已排过
                        const already = scheduledKeys.has(`${o.id}:${pt.sourcePartId}`);

                        return (
                          <tr
                            key={pt.sourcePartId}
                            className={
                              already
                                ? "bg-white opacity-60"
                                : fm.checked
                                ? "bg-[#F0E6F6]"
                                : idx % 2 === 1
                                ? "bg-[#F9F9F9]"
                                : "bg-white"
                            }
                          >
                            {/* 选择复选框：已排部位禁用 */}
                            <td className="px-3 py-[10px] border-b border-[#E0E0E0]">
                              <input
                                type="checkbox"
                                checked={fm.checked}
                                disabled={already}
                                onChange={(e) =>
                                  setForm(o.id, pt.sourcePartId, {
                                    checked: e.target.checked,
                                  })
                                }
                                className={`w-[15px] h-[15px] ${already ? "cursor-not-allowed" : "cursor-pointer"}`}
                              />
                            </td>
                            {/* 子件 */}
                            <td className={`px-3 py-[10px] border-b border-[#E0E0E0] ${already ? "text-[#999999]" : "text-[#333333]"}`}>
                              {pt.itemName}
                            </td>
                            {/* 部位（已排时显示「已排」徽章） */}
                            <td className={`px-3 py-[10px] border-b border-[#E0E0E0] ${already ? "text-[#999999]" : "text-[#333333]"}`}>
                              <span className="inline-flex items-center gap-[6px]">
                                {pt.partName}
                                {already && (
                                  <span className="text-[11px] px-2 py-0.5 rounded bg-[#f3f4f6] text-[#9ca3af]">
                                    已排
                                  </span>
                                )}
                              </span>
                            </td>
                            {/* 部位总需求 */}
                            <td className={`px-3 py-[10px] border-b border-[#E0E0E0] ${already ? "text-[#999999]" : "text-[#333333]"}`}>
                              {fmt(pt.totalDemand)}
                            </td>
                            {/* 标准日产能（纯数字，无单位） */}
                            <td className={`px-3 py-[10px] border-b border-[#E0E0E0] ${already ? "text-[#999999]" : "text-[#333333]"}`}>
                              {pt.dailyCapacity > 0 ? fmt(pt.dailyCapacity) : "—"}
                            </td>
                            {/* 指派机台列：机喷显只读输入框+保存按钮，人工喷显「—」 */}
                            <td className="px-3 py-[10px] border-b border-[#E0E0E0]">
                              {isMachine ? (
                                <div className="flex items-center gap-1">
                                  {/* 只读输入框：显示已选机台（用「、」连接），点击进入编辑态；已排时禁用 */}
                                  <input
                                    type="text"
                                    readOnly
                                    disabled={already}
                                    value={fm.machineNos.join("、")}
                                    onClick={() => !already && setActiveMachineKey(rowKey)}
                                    placeholder="点击指派机台"
                                    className={`w-[140px] rounded-[6px] px-2 py-[6px] text-[13px] bg-white focus:outline-none transition-all ${
                                      already
                                        ? "border border-[#E0E0E0] text-[#999999] cursor-not-allowed"
                                        : isActiveRow
                                        ? // 编辑中：绿色高亮边框
                                          "border-2 border-[#047857] ring-1 ring-[#34d399] text-[#333333] cursor-pointer"
                                        : // 普通态：轻边框
                                          `border border-[#E0E0E0] hover:border-[#047857] cursor-pointer ${fm.machineNos.length === 0 ? "text-[#999999]" : "text-[#333333]"}`
                                    }`}
                                  />
                                  {/* 保存（确认）按钮：只在编辑态显示 */}
                                  {isActiveRow && (
                                    <button
                                      type="button"
                                      onClick={() => setActiveMachineKey(null)}
                                      title="确认选机台，退出编辑"
                                      className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-[6px] bg-[#34d399] text-white text-[14px] font-bold cursor-pointer hover:bg-[#047857] transition-colors shrink-0"
                                    >
                                      ✓
                                    </button>
                                  )}
                                  {/* 编辑中标识小标签 */}
                                  {isActiveRow && (
                                    <span className="text-[11px] text-[#047857] font-medium whitespace-nowrap">
                                      编辑中
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[12px] text-[#999999]">—</span>
                              )}
                            </td>
                            {/* 人数输入：已排时禁用 */}
                            <td className="px-3 py-[10px] border-b border-[#E0E0E0]">
                              <input
                                type="number"
                                min={1}
                                disabled={already}
                                value={fm.workerCount}
                                onChange={(e) =>
                                  setForm(o.id, pt.sourcePartId, {
                                    workerCount:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  })
                                }
                                placeholder="1"
                                className={`w-[54px] border border-[#E0E0E0] rounded-[6px] px-2 py-[6px] text-[14px] text-center bg-white focus:outline-none ${already ? "cursor-not-allowed text-[#999999]" : "focus:border-[#047857]"}`}
                              />
                            </td>
                            {/* 今日计划生产数输入：已排时禁用 */}
                            <td className="px-3 py-[10px] border-b border-[#E0E0E0]">
                              <input
                                type="number"
                                min={1}
                                disabled={already}
                                value={fm.plannedQty}
                                onChange={(e) =>
                                  setForm(o.id, pt.sourcePartId, {
                                    plannedQty:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  })
                                }
                                placeholder="填计划数"
                                className={`w-[100px] border rounded-[6px] px-2 py-[6px] text-[14px] text-right focus:outline-none ${
                                  already
                                    ? "bg-white text-[#999999] border-[#E0E0E0] cursor-not-allowed"
                                    : qtyBad
                                    ? "bg-[#F4B7BE] text-[#C91D32] border-[#C91D32]"
                                    : "bg-white text-[#333333] border-[#E0E0E0] focus:border-[#047857]"
                                }`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ===== 底部保存栏 ===== */}
      <div className="flex justify-end gap-3 items-center mt-2">
        <span className="mr-auto text-[13px] text-[#999999]">
          {checkedCount > 0
            ? `已勾 ${checkedCount} 个部位待生成计划行 · 红框=计划数未填（保存时拦截）`
            : "请勾选需要安排的部位"}
        </span>
        <button
          type="button"
          onClick={() => {
            setForms({});
            setOpenOrders(new Set());
          }}
          className="bg-white border border-[#E0E0E0] text-[#333333] rounded-[8px] px-6 py-[11px] text-[15px] cursor-pointer hover:bg-[#f3f4f6]"
        >
          取消
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="bg-[#34d399] hover:bg-[#047857] disabled:bg-[#CCCCCC] text-white font-bold rounded-[8px] px-6 py-[11px] text-[15px] transition-colors"
        >
          {saving ? "保存中…" : "保存排期 → 生成待录单"}
        </button>
      </div>
    </div>
  );
}
