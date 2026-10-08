// 塑胶物料资料页:场景对照老系统 web/src/pages/plastics/PlasticMaterialMasterPage.tsx
// (类别树/28列固定表头/工模带出/从BOM选料/批量删除/价格脱敏);导入解析契约由 materialImport.test.ts 覆盖。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticMaterialMasterPage from "@/pages/PlasticMaterialMasterPage";

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "塑胶仓储", 菜单: "塑胶物料资料", 打开: true, 保存: true, 删除: true, 单价: true },
];

const ROW = {
  id: 1, ID: 1, 物料编号: "PL-1", 客户: "客户一", 款号: "92125-MA", 工模编号: "MOLD-1",
  物料名称: "胶件A", 颜色: "白", 色粉号: "CF-1", 原料名称: "ABS", 用料名称: "ABS白",
  加工内容: "喷油", 加工总单价: 1.2, 二次加工: "丝印", 二次加工价: 0.3,
  整啤净重: 12, 原胶件单净重: 11, 整啤模腔数: 4, 套数: 1, 出模数: 4, 用量: 1,
  啤机机型: "120T", 模具日产量: 5000, 啤机价钱: 0.5, 胶件啤工价: 0.4,
  原料单价: 0.2, 胶件料价: 0.6, 单价: 1.1, 备注: "注", 其他成本: 0.1,
};

const MOLD = {
  ID: 7, 工模编号: "MOLD-9", 工模名称: "九号模", 颜色: "黑", 色粉号: "CF-9",
  用料名称: "PC黑", 啤机机型: "160T", 整啤模腔数: 8, 水口比例: 0.05, 模具日产量: 8000,
  整啤毛重: 30, 整啤净重: 28, 啤机价钱: 0.8, 胶件啤工价: 0.6, 胶料单价: 0.33, 原胶料单价: 0.31,
};

const CATS = [{ 编号: "胶件", 类别: "胶件", 数量: 3, 父级: null }];

interface Cfg {
  perms?: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function installFetch(cfg: Cfg) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      const call: Call = { url, method, body };
      calls.push(call);
      const custom = cfg.onCall?.(call);
      if (custom) return custom;
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms ?? PERMS_FULL));
      if (p === "/api/plastic-material-master/categories") return json(CATS);
      if (p === "/api/plastic-material-master" && method === "GET")
        return json({ items: [ROW], total: 1 });
      if (p === "/api/master/plastic-molds") return json({ items: [MOLD], total: 1 });
      if (p === "/api/master/plastic-materials/1" && method === "GET") return json({ ...ROW });
      if (/^\/api\/master\/plastic-materials\/\d+$/.test(p) && method === "PUT") return json(body);
      if (/^\/api\/master\/plastic-materials\/\d+$/.test(p) && method === "DELETE") return noContent();
      if (p === "/api/master/plastic-materials" && method === "POST") return json({ id: 2 });
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg = {}) => {
  const calls = installFetch(cfg);
  renderWithProviders(<PlasticMaterialMasterPage />, "/plastic-material-master");
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("PL-1")).toBeInTheDocument());

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("塑胶物料资料", () => {
  it("28 列固定表头渲染 + 行数据(塑胶货号=款号,原胶件单价=单价)", async () => {
    setup();
    await waitList();
    for (const h of [
      "物料编号", "客户", "塑胶货号", "工模编号", "物料名称", "颜色", "色粉号",
      "原料名称", "用料名称", "加工内容", "加工总单价(HKD)", "二次加工", "二次加工价",
      "整啤净重", "原胶件单净重", "整啤模腔数", "套数", "出模数", "用量", "啤机机型",
      "模具日产量", "啤机价钱", "胶件啤工价", "原料单价", "胶件料价", "原胶件单价", "备注", "其他成本",
    ])
      expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("92125-MA")).toBeInTheDocument();
    expect(screen.getByText("1.1")).toBeInTheDocument();
  });

  it("无 单价 权限位:价格列脱敏为 ***", async () => {
    setup({
      perms: [{ 组: "塑胶仓储", 菜单: "塑胶物料资料", 打开: true, 保存: true, 删除: true, 单价: false }],
    });
    await waitList();
    expect(screen.getAllByText("***").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("1.1")).not.toBeInTheDocument();
  });

  it("新增先弹工模选择器:点工模行带出工模字段(原料单价 ← 胶料单价)", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getByText("新增"));
    await waitFor(() => expect(screen.getAllByText("选择工模").length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.getByText("MOLD-9")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MOLD-9"));
    // 进入新增弹窗,工模字段已带出
    await waitFor(() => expect(screen.getByLabelText("工模编号")).toHaveValue("MOLD-9"));
    expect(screen.getByLabelText("颜色")).toHaveValue("黑");
    expect(screen.getByLabelText("原料单价")).toHaveValue(0.33);
    expect(screen.getByLabelText("啤机机型")).toHaveValue("160T");
  });

  it("保存:数值列转数字,POST /master/plastic-materials", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("新增"));
    await waitFor(() => expect(screen.getByText("MOLD-9")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MOLD-9"));
    await waitFor(() => expect(screen.getByLabelText("工模编号")).toHaveValue("MOLD-9"));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "PL-NEW" } });
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "新胶件" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/plastic-materials" &&
            c.body?.物料编号 === "PL-NEW" &&
            c.body?.原料单价 === 0.33 &&
            c.body?.货币 === "HK$",
        ),
      ).toBe(true),
    );
  });

  it("勾选多选批量删除:逐条 DELETE", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByLabelText("勾选 PL-1"));
    fireEvent.click(screen.getByText(/删除\(1\)/));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /确认删除/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/master/plastic-materials/1"),
      ).toBe(true),
    );
  });

  it("从BOM选料:载入款号 BOM,点行带出物料进新增弹窗", async () => {
    const cfg: Cfg = {
      onCall: (c) => {
        const p = new URL(c.url, "http://test").pathname;
        if (p === "/api/styles/92125-MA/materials")
          return json({
            款号: "92125-MA",
            款式: "产品一",
            单头: { 客户名称: "客户一" },
            物料: [
              { 物料编号: "PL-B1", 物料名称: "BOM胶件", 物料类别: "塑胶", 规格: "S", 颜色: "红", 单位: "个", 使用数量: 2 },
            ],
          });
        return undefined;
      },
    };
    setup(cfg);
    await waitList();
    fireEvent.click(screen.getByText("从BOM选料"));
    await waitFor(() => expect(screen.getByLabelText("BOM款号")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("BOM款号"), { target: { value: "92125-MA" } });
    fireEvent.click(screen.getByText("载入"));
    await waitFor(() => expect(screen.getByText("BOM胶件")).toBeInTheDocument());
    fireEvent.click(screen.getByText("BOM胶件"));
    await waitFor(() => expect(screen.getByLabelText("物料编号")).toHaveValue("PL-B1"));
    expect(screen.getByLabelText("物料名称")).toHaveValue("BOM胶件");
    expect(screen.getByLabelText("塑胶货号")).toHaveValue("92125-MA");
    expect(screen.getByLabelText("用量")).toHaveValue(2);
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup({ perms: [] });
    await waitFor(() => expect(screen.getByText("无权访问塑胶物料资料")).toBeInTheDocument());
  });
});
