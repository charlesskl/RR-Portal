// 物料库存查询页:对照老系统 web/src/pages/materials/MaterialInventoryPage.tsx 逐条补齐
// (筛选维度 仓库/关键字/物料类别/含零库存、货号列、负库存红色),导出对齐
// web/src/__tests__/tableExport.test.ts 契约;密度三档(紧凑32/标准40/宽松48)持久化到
// localStorage `web2.tableDensity`(useTableDensity,全站共用)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { buildCsv, downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { TABLE_DENSITY_KEY } from "@/hooks/useTableDensity";
import InventoryPage from "@/pages/InventoryPage";

// jsdom 无布局,虚拟滚动拿不到可视高度;桩成「全量渲染,行高取 estimateSize」,
// 正好用来断言三档行高 32/40/48。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({
          index: i,
          start: i * size,
          size,
          key: i,
        })),
      measure: () => {},
    };
  },
}));

// downloadCsv/printTable 触发浏览器下载/新窗口,桩掉;buildCsv 保留真身供纯函数断言。
vi.mock("@/lib/tableExport", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tableExport")>();
  return { ...mod, downloadCsv: vi.fn(), printTable: vi.fn() };
});

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ROWS = [
  {
    物料编号: "M-001", 货号: "H-100", 物料名称: "斜纹布料", 规格: "幅宽150cm",
    物料类别: "面料", 单位: "米", 仓库: "原料仓", 库存数量: 120.5,
  },
  {
    物料编号: "M-002", 货号: "H-200", 物料名称: "环保胶水", 规格: "500ml",
    物料类别: "辅料", 单位: "瓶", 仓库: "辅料仓", 库存数量: -3,
  },
];

const CATS = [
  { 类别: "面料", 数量: 8 },
  { 类别: "辅料", 数量: 5 },
];

type Call = { url: string; method: string };

function installFetch(rows: unknown = ROWS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const u = new URL(url, "http://test");
      if (u.pathname.endsWith("/me/permissions")) return json(permRowsToMap([]));
      if (u.pathname === "/api/material-inventory/categories") return json(CATS);
      if (u.pathname === "/api/material-inventory") return json(rows);
      return json({ 消息: `unhandled ${u.pathname}` }, 404);
    }),
  );
  return calls;
}

const listCalls = (calls: Call[]) =>
  calls
    .filter((c) => new URL(c.url, "http://test").pathname === "/api/material-inventory")
    .map((c) => new URL(c.url, "http://test"));

const rowHeightOf = (text: string) =>
  (screen.getByText(text).closest("[style*='height']") as HTMLElement).style.height;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(downloadCsv).mockClear();
  vi.mocked(printTable).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------- 导出 CSV 纯函数(契约对照 web/src/__tests__/tableExport.test.ts) ----------

const cols: ExportCol[] = [
  { title: "物料编号", key: "物料编号" },
  { title: "库存数量", key: "库存数量" },
  { title: "含零", key: "含零", fmt: (v) => (v === "1" ? "是" : "否") },
];

describe("buildCsv(对照老系统 tableExport 场景)", () => {
  it("表头 + 行,fmt 生效", () => {
    const csv = buildCsv(cols, [{ 物料编号: "M-001", 库存数量: 100, 含零: "1" }]);
    expect(csv).toBe("物料编号,库存数量,含零\nM-001,100,是");
  });

  it("含逗号/引号/换行的字段被双引号包裹并转义", () => {
    const csv = buildCsv([{ title: "规格", key: "规格" }], [{ 规格: 'a,b"c\nd' }]);
    expect(csv).toBe('规格\n"a,b""c\nd"');
  });

  it("空/缺失值 -> 空串", () => {
    const csv = buildCsv(cols, [{ 物料编号: "M-002" }]);
    expect(csv).toBe("物料编号,库存数量,含零\nM-002,,否");
  });
});

// ---------- 页面 ----------

describe("InventoryPage", () => {
  it("渲染行/货号列/bento 卡,负库存红色", async () => {
    installFetch();
    renderWithProviders(<InventoryPage />);

    await screen.findByText("M-001");
    expect(screen.getByText("H-100")).toBeInTheDocument(); // 货号列(对照旧页)
    expect(screen.getByText("斜纹布料")).toBeInTheDocument();

    // bento 卡:物料条数 2 / 负库存条数 1
    expect(screen.getByText("物料条数").parentElement).toHaveTextContent("2");
    expect(screen.getByText("负库存条数").parentElement).toHaveTextContent("1");

    // 负库存红色
    const neg = screen.getByText("-3");
    expect(neg.className).toContain("text-[#dc2626]");

    // 底栏
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });

  it("查询把关键字/含零库存带进请求参数,重置清空", async () => {
    const calls = installFetch();
    renderWithProviders(<InventoryPage />);
    await screen.findByText("M-001");

    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "胶水" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    await waitFor(() => {
      const hit = listCalls(calls).some(
        (u) => u.searchParams.get("keyword") === "胶水" && u.searchParams.get("含零库存") === "true",
      );
      expect(hit).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /重置/ }));
    // 重置回初始筛选(queryKey 与初始一致,不一定再发请求),断言输入态被清空
    expect(screen.getByLabelText("关键字")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("筛选条件不变时再点查询:显式 refetch 重发请求(keep-alive 下不读旧缓存)", async () => {
    const calls = installFetch();
    renderWithProviders(<InventoryPage />);
    await screen.findByText("M-001");
    const before = listCalls(calls).length;

    // 不改任何筛选条件直接再点查询:queryKey 哈希相同,靠显式 refetch 拿最新库存
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));

    await waitFor(() => expect(listCalls(calls).length).toBeGreaterThan(before));
  });

  it("导出EXCEL/打印走 tableExport,列与表格一致", async () => {
    installFetch();
    renderWithProviders(<InventoryPage />);
    await screen.findByText("M-001");

    fireEvent.click(screen.getByRole("button", { name: /导出EXCEL/ }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [fname, ecols, erows] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fname).toBe("物料库存.csv");
    expect(ecols.map((c) => c.title)).toEqual([
      "物料编号", "货号", "物料名称", "规格", "物料类别", "单位", "仓库", "库存数量",
    ]);
    expect(erows).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /打印/ }));
    expect(printTable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(printTable).mock.calls[0][0]).toBe("物料库存查询");

    // 空结果不导出
    vi.mocked(downloadCsv).mockClear();
    cleanup();
    installFetch([]);
    renderWithProviders(<InventoryPage />);
    await screen.findByText("暂无数据");
    fireEvent.click(screen.getByRole("button", { name: /导出EXCEL/ }));
    expect(downloadCsv).not.toHaveBeenCalled();
  });

  it("密度三档:32/40/48 行高,localStorage 持久化,重开保持", async () => {
    installFetch();
    const first = renderWithProviders(<InventoryPage />);
    await screen.findByText("M-001");

    // 默认标准 40px
    expect(rowHeightOf("M-001")).toBe("40px");

    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(rowHeightOf("M-001")).toBe("32px");
    expect(localStorage.getItem(TABLE_DENSITY_KEY)).toBe("compact");

    fireEvent.click(screen.getByRole("button", { name: "宽松" }));
    expect(rowHeightOf("M-001")).toBe("48px");
    expect(localStorage.getItem(TABLE_DENSITY_KEY)).toBe("relaxed");

    // 重开页面保持宽松档
    first.unmount();
    renderWithProviders(<InventoryPage />);
    await screen.findByText("M-001");
    expect(rowHeightOf("M-001")).toBe("48px");
  });

  it("localStorage 预置紧凑档,进入即 32px", async () => {
    localStorage.setItem(TABLE_DENSITY_KEY, "compact");
    installFetch();
    renderWithProviders(<InventoryPage />);
    await screen.findByText("M-001");
    expect(rowHeightOf("M-001")).toBe("32px");
  });

  it("加载失败给错误态并可重试", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ 消息: "boom" }, 500)),
    );
    renderWithProviders(<InventoryPage />);
    await screen.findByText("加载失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
