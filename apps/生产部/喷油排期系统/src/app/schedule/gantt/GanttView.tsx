"use client";
// 甘特图视图客户端组件
// 改造说明：整月视图 + 左侧 7 列冻结 + 右侧时间轴独立横滑 + 日历/月份选择器
// 业务逻辑（数量聚合 / 部位防重 / 横条区间 / 逾期判断 / 三级展开）全部保持原样
// 本批无实绩 → 横条只用「已派未做(灰虚)/逾期(红)」，未排期行标「待排期」无横条

import { Fragment, useState, useMemo, useRef, useEffect } from "react";
import type { GanttOrder } from "@/lib/scheduleData";
import { filterGanttOrders, isOverdue } from "@/lib/ganttFilter";

// ─── 类型定义 ─────────────────────────────────────────────────

type Props = {
  orders: GanttOrder[];
  today: string; // 'YYYY-MM-DD'
};

// 子件分组结构（按 itemName 聚合 plans）
type SubItem = {
  itemName: string;
  parts: PartGroup[];
};

// 部位分组结构（按 partName 聚合 plans）
type PartGroup = {
  partName: string;
  sourcePartId: number | null;
  totalQty: number;
  // 最早计划日 ~ 最晚计划日（用于绘制横条区间）
  firstDate: string | null;
  lastDate: string | null;
};

// ─── 布局常量 ─────────────────────────────────────────────────

/** 每个日期格固定宽度(px) —— 沿用原两周视图的格宽 */
const CELL_W = 50;
/** 左侧 6 个固定列宽：订单号 / 款号 / 子件部位 / 数量 / 交期 / 进度 */
const LEFT_COLS = [130, 80, 140, 80, 80, 110];
/** 各列冻结(sticky)时的 left 偏移 = 前面列宽的前缀和 */
const LEFT_OFFSETS = LEFT_COLS.reduce<number[]>((acc, _w, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + LEFT_COLS[i - 1]);
  return acc;
}, []);
/** 左侧固定区总宽 = 700 */
const LEFT_TOTAL = LEFT_COLS.reduce((s, w) => s + w, 0);
/** 月份网格中文名 */
const MONTH_NAMES = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

// ─── 工具函数 ─────────────────────────────────────────────────

/** 把 plans 按 itemName 分组，再按 partName 分组 */
function groupPlans(plans: GanttOrder["plans"]): SubItem[] {
  const itemMap = new Map<string, Map<string, PartGroup>>();

  for (const p of plans) {
    if (!itemMap.has(p.itemName)) {
      itemMap.set(p.itemName, new Map());
    }
    const partMap = itemMap.get(p.itemName)!;
    const key = p.partName;
    if (!partMap.has(key)) {
      partMap.set(key, {
        partName: p.partName,
        sourcePartId: p.sourcePartId,
        totalQty: 0,
        firstDate: null,
        lastDate: null,
      });
    }
    const pg = partMap.get(key)!;
    pg.totalQty += p.plannedQty;
    // 更新最早/最晚计划日
    if (pg.firstDate === null || p.planDate < pg.firstDate) {
      pg.firstDate = p.planDate;
    }
    if (pg.lastDate === null || p.planDate > pg.lastDate) {
      pg.lastDate = p.planDate;
    }
  }

  const result: SubItem[] = Array.from(itemMap.entries()).map(
    ([itemName, partMap]) => ({
      itemName,
      parts: Array.from(partMap.values()),
    })
  );
  return result;
}

/** 生成某年某月的整月日期列表（month: 0-11） */
function buildMonthDates(year: number, month: number): string[] {
  const dates: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  // new Date(year, month+1, 0) = 该月最后一天，getDate() = 当月天数
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  }
  return dates;
}

/** 判断是否周末（0=周日，6=周六） */
function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

/** 格式化日期显示为 M/D */
function fmtMD(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 计算横条在时间轴上的位置和宽度（百分比）。
 * 百分比相对「时间轴单元格」宽度（= 当月天数 × CELL_W），故每格固定宽后映射仍正确。
 * @returns { left, width } 均为百分比字符串（如 "14.28%"）
 */
function calcBarPos(
  startDate: string,
  endDate: string,
  dates: string[]
): { left: string; width: string } | null {
  const startIdx = dates.indexOf(startDate);
  const endIdx = dates.indexOf(endDate);
  if (startIdx < 0 && endIdx < 0) return null;

  const s = startIdx < 0 ? 0 : startIdx;
  const e = endIdx < 0 ? dates.length - 1 : endIdx;
  const total = dates.length;

  const left = (s / total) * 100;
  const width = ((e - s + 1) / total) * 100;
  return {
    left: `${left.toFixed(2)}%`,
    width: `${Math.max(width, 100 / total).toFixed(2)}%`,
  };
}

// 逾期判断 isOverdue 已抽到 @/lib/ganttFilter（与月份过滤共享，便于单测）

/** 交期标签样式 */
function DueTag({ date, overdue }: { date: string | null; overdue: boolean }) {
  if (!date) return <span style={{ color: "#999999", fontSize: "11px" }}>—</span>;
  const cls = overdue ? "urgent" : "ok";
  const style: React.CSSProperties = {
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: "10px",
    fontSize: "11px",
    background: cls === "urgent" ? "#FEE2E2" : "#DCFCE7",
    color: cls === "urgent" ? "#991B1B" : "#14532D",
  };
  return <span style={style}>{overdue ? `⚠ ${fmtMD(date)}` : fmtMD(date)}</span>;
}

/** 左侧固定列样式：在 tdBase 基础上叠加 sticky 冻结 + 行背景色（防止横滚时透出时间轴内容） */
function leftColStyle(
  base: React.CSSProperties,
  idx: number,
  bg: string
): React.CSSProperties {
  return {
    ...base,
    width: LEFT_COLS[idx],
    minWidth: LEFT_COLS[idx],
    position: "sticky",
    left: LEFT_OFFSETS[idx],
    background: bg,
    // 层级要高于今日红线(z5)，横滑时红线/「今」标签进入冻结列区域会被遮住
    zIndex: 6,
  };
}

// ─── 甘特条组件 ───────────────────────────────────────────────

type BarProps = {
  firstDate: string | null;
  lastDate: string | null;
  overdue: boolean;
  label?: string;
  dates: string[];
};

function GanttBar({ firstDate, lastDate, overdue, label, dates }: BarProps) {
  if (!firstDate || !lastDate) return null;
  const pos = calcBarPos(firstDate, lastDate, dates);
  if (!pos) return null;

  const barStyle: React.CSSProperties = {
    position: "absolute",
    top: "4px",
    height: "16px",
    left: pos.left,
    width: pos.width,
    borderRadius: "3px",
    padding: "0 6px",
    fontSize: "10px",
    lineHeight: "16px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    ...(overdue
      ? { background: "#C91D32", color: "#fff" }
      : {
          background: "#CBD5E1",
          color: "#475569",
          border: "1px dashed #94A3B8",
        }),
  };

  return <div style={barStyle}>{label || ""}</div>;
}

// ─── 时间轴单元格 ─────────────────────────────────────────────

type TimelineCellProps = {
  dates: string[];
  today: string;
  showTodayLine?: boolean;
  children?: React.ReactNode;
};

function TimelineCell({ dates, today, showTodayLine, children }: TimelineCellProps) {
  const todayIdx = dates.indexOf(today);
  const total = dates.length;
  const axisWidth = total * CELL_W; // 时间轴固定总宽

  // 今日红线位置（在格子正中）—— today 不在当月则不显示
  const todayLineLeft =
    todayIdx >= 0 ? `${((todayIdx + 0.5) / total) * 100}%` : null;

  // 找出周末列索引
  const weekendPairs: { start: number; count: number }[] = [];
  let i = 0;
  while (i < dates.length) {
    if (isWeekend(dates[i])) {
      let j = i;
      while (j < dates.length && isWeekend(dates[j])) j++;
      weekendPairs.push({ start: i, count: j - i });
      i = j;
    } else {
      i++;
    }
  }

  const cellStyle: React.CSSProperties = {
    padding: 0,
    position: "relative",
    width: axisWidth,
    minWidth: axisWidth,
    // 每格一条竖线：每 CELL_W 像素在左缘画 1px 分割线（干净，一格一线）
    backgroundImage:
      "linear-gradient(to right, #E0E0E0 0, #E0E0E0 1px, transparent 1px)",
    backgroundSize: `${CELL_W}px 100%`,
  };

  return (
    <td style={cellStyle}>
      <div style={{ position: "relative", height: "24px" }}>
        {/* 周末底纹 */}
        {weekendPairs.map((wp) => (
          <div
            key={wp.start}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${(wp.start / total) * 100}%`,
              width: `${(wp.count / total) * 100}%`,
              background: "rgba(4,120,87,0.05)",
              pointerEvents: "none",
            }}
          />
        ))}
        {/* 今日红线 */}
        {showTodayLine && todayLineLeft && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: todayLineLeft,
              width: "2px",
              background: "#E88EA0",
              zIndex: 5,
              boxShadow: "0 0 0 1px rgba(232,142,160,.3)",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "-16px",
                left: "-8px",
                background: "#E88EA0",
                color: "#fff",
                fontSize: "10px",
                padding: "1px 4px",
                borderRadius: "2px",
              }}
            >
              今
            </span>
          </div>
        )}
        {children}
      </div>
    </td>
  );
}

// ─── 月份选择器浮层 ───────────────────────────────────────────

type MonthPickerProps = {
  year: number;
  month: number; // 0-11
  onPick: (year: number, month: number) => void;
};

function MonthPicker({ year, month, onPick }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  // 面板内临时浏览的年份（可与当前选中年份不同）
  const [viewYear, setViewYear] = useState(year);
  const ref = useRef<HTMLDivElement>(null);

  // 点击浮层外部自动关闭
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const yearBtn: React.CSSProperties = {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "16px",
    color: "#999999",
    padding: "0 8px",
    lineHeight: 1,
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* 日历按钮 */}
      <button
        type="button"
        onClick={() => {
          setViewYear(year); // 每次打开回到当前选中年份
          setOpen((o) => !o);
        }}
        title="选择月份"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "34px",
          height: "32px",
          border: "1px solid #E0E0E0",
          borderRadius: "6px",
          background: open ? "#ECFDF5" : "#fff",
          cursor: "pointer",
          fontSize: "16px",
          lineHeight: 1,
        }}
      >
        📅
      </button>

      {/* 浮层 */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: "280px",
            background: "#fff",
            border: "1px solid #E0E0E0",
            borderRadius: "8px",
            boxShadow: "0 6px 18px rgba(0,0,0,.12)",
            padding: "12px",
            zIndex: 50,
          }}
        >
          {/* 年份切换行 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
            }}
          >
            <button
              type="button"
              style={yearBtn}
              onClick={() => setViewYear((y) => y - 1)}
            >
              «
            </button>
            <strong style={{ fontSize: "14px", color: "#333333" }}>
              {viewYear} 年
            </strong>
            <button
              type="button"
              style={yearBtn}
              onClick={() => setViewYear((y) => y + 1)}
            >
              »
            </button>
          </div>

          {/* 12 个月网格（4 列 × 3 行）*/}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "8px",
            }}
          >
            {MONTH_NAMES.map((m, i) => {
              const selected = viewYear === year && i === month;
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => {
                    onPick(viewYear, i);
                    setOpen(false);
                  }}
                  style={{
                    padding: "8px 0",
                    textAlign: "center",
                    fontSize: "13px",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: selected ? 700 : 400,
                    color: selected ? "#047857" : "#333333",
                    background: selected ? "#ECFDF5" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!selected) e.currentTarget.style.background = "#F4FBF8";
                  }}
                  onMouseLeave={(e) => {
                    if (!selected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────

export default function GanttView({ orders, today }: Props) {
  // 展开状态：{ [orderId]: boolean }（订单是否展开子件）
  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({});
  // 展开状态：{ [orderId_itemName]: boolean }（子件是否展开部位）
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // 搜索/过滤
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("全部状态");

  // 选中年月（默认 today 所在自然月）
  const [ym, setYm] = useState(() => {
    const d = new Date(today);
    return { year: d.getFullYear(), month: d.getMonth() }; // month: 0-11
  });

  // 当前月整月日期列表
  const dates = useMemo(() => buildMonthDates(ym.year, ym.month), [ym]);
  const monthLabel = `${ym.year} 年 ${ym.month + 1} 月`;
  // 表格总宽 = 左侧固定区 + 时间轴（当月天数 × 格宽）
  const tableWidth = LEFT_TOTAL + dates.length * CELL_W;

  // 过滤订单：搜索 + 状态 + 当前月份交叉（口径见 @/lib/ganttFilter）
  const filteredOrders = useMemo(
    () =>
      filterGanttOrders(orders, {
        year: ym.year,
        month: ym.month,
        filterStatus,
        searchText,
      }),
    [orders, searchText, filterStatus, ym]
  );

  // 待排期订单总数（与所选月份无关）——月份视图下这些单被隐藏，用顶部标签提示
  const unscheduledCount = useMemo(
    () => orders.filter((o) => !o.scheduled).length,
    [orders]
  );

  const toggleOrder = (id: number) => {
    setExpandedOrders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleItem = (orderId: number, itemName: string) => {
    const key = `${orderId}_${itemName}`;
    setExpandedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ── 表头样式 ──────────────────────────────────────────────
  const thStyle: React.CSSProperties = {
    background: "#f0fdf4",
    color: "#047857",
    fontWeight: 700,
    padding: "8px 8px",
    textAlign: "left",
    whiteSpace: "nowrap",
    borderRight: "1px solid #d1fae5",
    borderBottom: "1px solid #d1fae5",
    position: "sticky",
    top: 0,
    zIndex: 3,
  };
  const thCenter: React.CSSProperties = { ...thStyle, textAlign: "center" };

  /** 表头左侧固定列：在 thStyle(已含 top:0) 基础上叠加 left 冻结 + 更高层级（角上最高） */
  const headLeft = (idx: number, center = false): React.CSSProperties => ({
    ...(center ? thCenter : thStyle),
    width: LEFT_COLS[idx],
    minWidth: LEFT_COLS[idx],
    left: LEFT_OFFSETS[idx],
    // 表头冻结列在左上角，层级最高（盖住表体冻结列 z6 与时间轴表头 z3）
    zIndex: 7,
  });

  // ── 单元格样式 ──────────────────────────────────────────
  const tdBase: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #E0E0E0",
    borderRight: "1px solid #E0E0E0",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', background: "#F0F4FF", padding: "16px", fontSize: "13px", minHeight: "100vh" }}>
      <div style={{ fontSize: "13px", color: "#999999", marginBottom: "12px" }}>
        订单跟踪表（含甘特图）· 三级展开：订单 → 子件 → 部位 · 显示所有订单
      </div>

      {/* 顶部操作栏 */}
      <div
        style={{
          background: "#fff",
          borderRadius: "6px",
          boxShadow: "0 1px 3px rgba(0,0,0,.06)",
          padding: "12px 16px",
          marginBottom: "12px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* 面包屑 */}
        <div style={{ color: "#999999", fontSize: "13px" }}>
          <span style={{ color: "#047857", cursor: "pointer" }}>印喷部</span>
          {" / "}
          <span style={{ color: "#047857", cursor: "pointer" }}>排期</span>
          {" / "}
          <strong style={{ color: "#333333" }}>甘特图视图 · {monthLabel}</strong>
        </div>

        {/* 状态过滤 */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            border: "1px solid #E0E0E0",
            borderRadius: "4px",
            padding: "5px 12px",
            fontSize: "13px",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          <option>全部状态</option>
          <option>已排期</option>
          <option>待排期</option>
          <option>逾期</option>
        </select>

        {/* 搜索框 */}
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="🔍 搜索订单号/款号"
          style={{
            border: "1px solid #E0E0E0",
            borderRadius: "4px",
            padding: "5px 12px",
            fontSize: "13px",
            background: "#fff",
            minWidth: "180px",
          }}
        />

        {/* 日历按钮 + 月份选择器浮层（替换原「两周视图」框）*/}
        <MonthPicker
          year={ym.year}
          month={ym.month}
          onPick={(year, month) => setYm({ year, month })}
        />

        <div style={{ flex: 1 }} />
        {/* 未排期提示标签（黄底棕字棕框，数字红色）——照实绩录入「待录」金色卡配色 */}
        {unscheduledCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: "#FFF8E1",
              border: "1px solid #92400E",
              color: "#92400E",
              borderRadius: "6px",
              padding: "4px 12px",
              fontSize: "12px",
              fontWeight: 500,
            }}
            title="未排期订单不在月份视图中显示，请到排期页处理"
          >
            未排期订单{" "}
            <strong style={{ color: "#C91D32", fontWeight: 700 }}>
              {unscheduledCount}
            </strong>{" "}
            条
          </span>
        )}
        <span style={{ fontSize: "12px", color: "#999999" }}>
          共 {filteredOrders.length} 个订单
        </span>
      </div>

      {/* 图例 */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E0E0E0",
          padding: "8px 14px",
          marginBottom: "12px",
          borderRadius: "6px",
          fontSize: "12px",
          color: "#999999",
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <strong style={{ color: "#333333" }}>时间条图例：</strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "20px", height: "8px", borderRadius: "2px", background: "#57B894" }} />
          已完工（本批暂无真实数据）
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "20px", height: "8px", borderRadius: "2px", background: "#2563EB" }} />
          进行中（本批暂无真实数据）
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "20px", height: "8px", borderRadius: "2px", background: "#CBD5E1", border: "1px dashed #94A3B8" }} />
          已派未做
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "20px", height: "8px", borderRadius: "2px", background: "#C91D32" }} />
          逾期
        </span>
      </div>

      {/* 主表格：左侧 7 列冻结，右侧时间轴随容器横向滚动 */}
      <div
        style={{
          background: "#fff",
          borderRadius: "6px",
          boxShadow: "0 1px 3px rgba(0,0,0,.06)",
          overflow: "auto",
          border: "1px solid #E0E0E0",
        }}
      >
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: "12px",
            tableLayout: "fixed",
            width: tableWidth,
          }}
        >
          {/* 表头 */}
          <thead>
            <tr>
              <th style={headLeft(0)}>订单号 / 名称</th>
              <th style={headLeft(1)}>款号</th>
              <th style={headLeft(2)}>子件 / 部位</th>
              <th style={headLeft(3, true)}>数量</th>
              <th style={headLeft(4, true)}>交期</th>
              <th style={headLeft(5, true)}>进度</th>
              {/* 时间轴表头：当月每天一格，固定 CELL_W 宽 */}
              <th
                style={{
                  ...thStyle,
                  padding: 0,
                  background: "#ecfdf5",
                  width: dates.length * CELL_W,
                  minWidth: dates.length * CELL_W,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${dates.length}, ${CELL_W}px)`,
                    fontSize: "11px",
                    color: "#047857",
                    fontWeight: 400,
                  }}
                >
                  {dates.map((d) => (
                    <span
                      key={d}
                      style={{
                        padding: "8px 0",
                        textAlign: "center",
                        borderRight: "1px solid #d1fae5",
                        background: isWeekend(d) ? "rgba(4,120,87,0.08)" : undefined,
                      }}
                    >
                      {fmtMD(d)}
                    </span>
                  ))}
                </div>
              </th>
            </tr>
          </thead>

          {/* 表体 */}
          <tbody>
            {filteredOrders.map((order) => {
              const overdue = isOverdue(order);
              const expanded = !!expandedOrders[order.id];
              const subItems = groupPlans(order.plans);

              // ── 订单汇总横条（有排期才显示）──
              const orderBarFirst = order.firstPlanDate;
              const orderBarLast = order.expectedOutDate;
              // 订单行背景色（左侧冻结列需显式同色，避免横滚透出时间轴）
              const orderBg = "#F4FBF8";

              return (
                <Fragment key={`order-${order.id}`}>
                  {/* ── 订单行 ── */}
                  <tr
                    style={{ background: orderBg, fontWeight: 500, cursor: "pointer" }}
                    onClick={() => {
                      if (order.scheduled) toggleOrder(order.id);
                    }}
                  >
                    {/* 订单号 */}
                    <td style={leftColStyle(tdBase, 0, orderBg)}>
                      {order.scheduled ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: "14px",
                            textAlign: "center",
                            color: expanded ? "#047857" : "#999999",
                            cursor: "pointer",
                            userSelect: "none",
                            marginRight: "4px",
                            fontSize: "10px",
                          }}
                        >
                          {expanded ? "▼" : "▶"}
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            width: "14px",
                            textAlign: "center",
                            color: "transparent",
                            marginRight: "4px",
                          }}
                        >
                          ▶
                        </span>
                      )}
                      <span style={{ color: "#047857", fontWeight: 600 }}>
                        {order.externalOrderNo}
                      </span>
                    </td>

                    {/* 款号 */}
                    <td style={leftColStyle(tdBase, 1, orderBg)}>{order.productNo}</td>

                    {/* 子件/部位：订单行显示概要 */}
                    <td style={leftColStyle({ ...tdBase, paddingLeft: "4px" }, 2, orderBg)}>
                      {order.scheduled
                        ? `（${subItems.length} 子件）`
                        : "—"}
                    </td>

                    {/* 数量：订单行 = 全部部位 totalDemand 之和（每部位一条，直接累加，
                        部位数量可不同，不能再按子件去重取第一条）。 */}
                    <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 3, orderBg)}>
                      {(() => {
                        const total = order.demandParts.reduce((s, dp) => s + dp.totalDemand, 0);
                        return total > 0 ? total.toLocaleString() : "—";
                      })()}
                    </td>

                    {/* 交期 */}
                    <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 4, orderBg)}>
                      <DueTag date={order.deliveryDate} overdue={overdue} />
                    </td>

                    {/* 进度：未排期标「待排期」，已排期显示预计出单日 */}
                    <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 5, orderBg)}>
                      {!order.scheduled ? (
                        <span style={{ color: "#999999", fontStyle: "italic", fontSize: "11px" }}>
                          待排期
                        </span>
                      ) : overdue ? (
                        <span style={{ color: "#C91D32", fontSize: "11px" }}>
                          ⚠ 逾期
                        </span>
                      ) : (
                        <span style={{ color: "#047857", fontSize: "11px" }}>
                          {order.expectedOutDate ? `预计 ${fmtMD(order.expectedOutDate)}` : "—"}
                        </span>
                      )}
                    </td>

                    {/* 时间轴：订单汇总条 */}
                    <TimelineCell dates={dates} today={today} showTodayLine>
                      {order.scheduled && orderBarFirst && orderBarLast && (() => {
                        const pos = calcBarPos(orderBarFirst, orderBarLast, dates);
                        if (!pos) return null;
                        // 汇总条：渐变显示
                        return (
                          <div
                            style={{
                              position: "absolute",
                              top: "7px",
                              height: "10px",
                              left: pos.left,
                              width: pos.width,
                              borderRadius: "5px",
                              background: overdue
                                ? "#C91D32"
                                : "linear-gradient(to right, #CBD5E1 0%, #CBD5E1 100%)",
                              cursor: "pointer",
                            }}
                          />
                        );
                      })()}
                      {!order.scheduled && (
                        <span
                          style={{
                            position: "absolute",
                            left: "8px",
                            top: "5px",
                            fontSize: "10px",
                            color: "#999999",
                            fontStyle: "italic",
                          }}
                        >
                          — 待排期（无计划，甘特无横条）—
                        </span>
                      )}
                    </TimelineCell>
                  </tr>

                  {/* ── 子件行（订单展开后显示）── */}
                  {expanded &&
                    subItems.map((sub) => {
                      const subKey = `${order.id}_${sub.itemName}`;
                      const subExpanded = !!expandedItems[subKey];
                      const subBg = "#FCFEFD"; // 子件行背景

                      // 子件的最早/最晚日期（从其所有部位推导）
                      const subFirstDate = sub.parts
                        .map((p) => p.firstDate)
                        .filter(Boolean)
                        .sort()[0] ?? null;
                      const subLastDate = sub.parts
                        .map((p) => p.lastDate)
                        .filter(Boolean)
                        .sort()
                        .reverse()[0] ?? null;

                      // 子件数量 = 该子件下各部位总需求之和（部位数量可不同，须累加，
                      // 例如青蛙：青蛙23694 + 青蛙前30780 + 青蛙后30780 + 顶盖1 30780 = 116034）。
                      const subDemand = order.demandParts
                        .filter((dp) => dp.itemName === sub.itemName)
                        .reduce((s, dp) => s + dp.totalDemand, 0);

                      return (
                        <Fragment key={`sub-${order.id}-${sub.itemName}`}>
                          {/* 子件行 */}
                          <tr
                            style={{ background: subBg, cursor: "pointer" }}
                            onClick={() => toggleItem(order.id, sub.itemName)}
                          >
                            <td style={leftColStyle(tdBase, 0, subBg)} />
                            <td style={leftColStyle(tdBase, 1, subBg)} />
                            {/* 子件名，带展开箭头 */}
                            <td style={leftColStyle({ ...tdBase, paddingLeft: "26px" }, 2, subBg)}>
                              <span
                                style={{
                                  display: "inline-block",
                                  width: "14px",
                                  textAlign: "center",
                                  color: subExpanded ? "#047857" : "#999999",
                                  cursor: "pointer",
                                  userSelect: "none",
                                  marginRight: "4px",
                                  fontSize: "10px",
                                }}
                              >
                                {subExpanded ? "▼" : "▶"}
                              </span>
                              {sub.itemName}
                            </td>
                            <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 3, subBg)}>
                              {subDemand > 0 ? subDemand.toLocaleString() : "—"}
                            </td>
                            <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 4, subBg)} />
                            <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 5, subBg)} />
                            {/* 子件时间条 */}
                            <TimelineCell dates={dates} today={today}>
                              <GanttBar
                                firstDate={subFirstDate}
                                lastDate={subLastDate}
                                overdue={overdue}
                                label={`${sub.itemName}`}
                                dates={dates}
                              />
                            </TimelineCell>
                          </tr>

                          {/* 部位行（子件展开后显示）*/}
                          {subExpanded &&
                            sub.parts.map((part) => {
                              const partBg = "#fff"; // 部位行背景
                              return (
                              <tr
                                key={`part-${order.id}-${sub.itemName}-${part.partName}`}
                                style={{ background: partBg }}
                              >
                                <td style={leftColStyle(tdBase, 0, partBg)} />
                                <td style={leftColStyle(tdBase, 1, partBg)} />
                                {/* 部位名 */}
                                <td style={leftColStyle({ ...tdBase, paddingLeft: "50px" }, 2, partBg)}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "1px 6px",
                                      fontSize: "10px",
                                      background: "#ECFDF5",
                                      color: "#047857",
                                      borderRadius: "2px",
                                      marginRight: "4px",
                                    }}
                                  >
                                    部位
                                  </span>
                                  {part.partName}
                                </td>
                                {/* 部位数量 = 该部位的总需求（每部位独立成品，数量可不同）。
                                    从 demandParts 按 (itemName, partName) 查找匹配条目。 */}
                                <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 3, partBg)}>
                                  {(() => {
                                    const dp = order.demandParts.find(
                                      (d) =>
                                        d.itemName === sub.itemName &&
                                        d.partName === part.partName
                                    );
                                    return dp ? dp.totalDemand.toLocaleString() : "—";
                                  })()}
                                </td>
                                <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 4, partBg)} />
                                <td style={leftColStyle({ ...tdBase, textAlign: "center" }, 5, partBg)}>
                                  <span style={{ fontSize: "11px", color: "#999999" }}>
                                    {part.firstDate ? fmtMD(part.firstDate) : "—"}
                                    {part.firstDate && part.lastDate && part.firstDate !== part.lastDate
                                      ? ` ~ ${fmtMD(part.lastDate)}`
                                      : ""}
                                  </span>
                                </td>
                                {/* 部位时间条：标签也改用需求量 */}
                                <TimelineCell dates={dates} today={today}>
                                  <GanttBar
                                    firstDate={part.firstDate}
                                    lastDate={part.lastDate}
                                    overdue={overdue}
                                    label={(() => {
                                      const dp = order.demandParts.find(
                                        (d) =>
                                          d.itemName === sub.itemName &&
                                          d.partName === part.partName
                                      );
                                      return dp ? dp.totalDemand.toLocaleString() : "";
                                    })()}
                                    dates={dates}
                                  />
                                </TimelineCell>
                              </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}

            {/* 空状态 */}
            {filteredOrders.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    padding: "40px",
                    color: "#999999",
                    fontSize: "13px",
                  }}
                >
                  暂无符合条件的订单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 交互说明 */}
      <div
        style={{
          marginTop: "14px",
          padding: "10px 14px",
          background: "#fff",
          border: "1px solid #E0E0E0",
          borderRadius: "6px",
          fontSize: "12px",
          color: "#999999",
        }}
      >
        💡 <strong style={{ color: "#333333" }}>交互说明：</strong>
        ① 点订单行展开子件 ·
        ② 点子件行展开部位 ·
        ③ 时间条上显示该部位的计划数 ·
        ④ 左侧信息列固定，右侧日期可横向滑动；点日历按钮切换月份 ·
        ⑤ 红色「今」竖线 = 当前日期（仅当月显示）· 切换月份只显示该月在产订单，未排期订单见右上角提示标签
      </div>
    </div>
  );
}
