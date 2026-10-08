// 生产单跟踪表页:场景对照老系统 web/src/pages/production/ProductionTrackingPage.tsx
// (关键字/审核/完成筛选,未完成数>0 红字,审核/完成徽标,无权访问)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import ProductionTrackingPage from "@/pages/ProductionTrackingPage";

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "业务单据", 菜单: "生产制单", 打开: true }];

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const ROWS = [
  {
    生产单号: "MO-2609-001", 标识: "", 款号: "K001", 款式: "毛绒熊", 客户名称: "客户一",
    日期: "2026-09-01", 下单日期: "2026-08-30", 交货日期: "2026-09-30",
    计划数量: 1000, 裁床数量: 600, 录入数量: 300, 未完成数: 700,
    装箱方式: "普通", 订单总箱数: 50, 完成: "否", 审核: "1",
  },
  {
    生产单号: "MO-2609-002", 标识: "急", 款号: "K002", 款式: "塑料车", 客户名称: "客户二",
    日期: "2026-09-02", 下单日期: null, 交货日期: null,
    计划数量: 500, 裁床数量: 500, 录入数量: 500, 未完成数: 0,
    装箱方式: "普通", 订单总箱数: 25, 完成: "是", 审核: "0",
  },
];

function installFetch(perms: unknown = PERMS_FULL, rows: unknown = ROWS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/production-reports/tracking") return json(rows);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown, rows?: unknown) => {
  const calls = installFetch(perms, rows);
  renderWithProviders(
    <Routes>
      <Route path="/production-tracking" element={<ProductionTrackingPage />} />
    </Routes>,
    "/production-tracking",
  );
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("MO-2609-001")).toBeInTheDocument());

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("生产单跟踪表", () => {
  it("渲染行:单号/款号/客户/数量列,未完成数>0 红字加粗", async () => {
    setup();
    await waitList();
    expect(screen.getByText("毛绒熊")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
    const owed = screen.getByText("700");
    expect(owed).toHaveClass("text-[#dc2626]");
    const table = screen.getByRole("table");
    expect(within(table).getByText("已审核")).toBeInTheDocument();
    expect(within(table).getByText("未审核")).toBeInTheDocument();
    expect(within(table).getByText("是")).toBeInTheDocument();
  });

  it("查询:关键字进入查询参数", async () => {
    const calls = setup();
    await waitList();
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "K001" } });
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/production-reports/tracking?keyword=K001")),
      ).toBe(true),
    );
  });

  it("审核/完成筛选即时生效进查询参数", async () => {
    const calls = setup();
    await waitList();
    pickOption("审核", "已审核");
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("%E5%AE%A1%E6%A0%B8=1"))).toBe(true),
    );
    pickOption("完成", "未完成");
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("%E5%AE%8C%E6%88%90=%E5%90%A6"))).toBe(true),
    );
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() =>
      expect(screen.getByText("无权访问 生产单跟踪表")).toBeInTheDocument(),
    );
  });

  it("打印:按当前行集开窗写 HTML(表头含生产单跟踪表)", async () => {
    setup();
    await waitList();
    const opened: { html: string }[] = [];
    const fakeWin = {
      document: { write: (h: string) => opened.push({ html: h }), close: () => {} },
      focus: () => {},
      print: () => {},
    };
    vi.stubGlobal("open", vi.fn(() => fakeWin));
    fireEvent.click(screen.getByText("打印"));
    expect(opened).toHaveLength(1);
    expect(opened[0].html).toContain("生产单跟踪表");
    expect(opened[0].html).toContain("MO-2609-001");
    expect(opened[0].html).toContain("已审核");
  });
});
