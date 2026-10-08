// 物料资料页:场景对照老系统 web/src/pages/materials/MaterialMasterPage.tsx
// (类别树/双击选中/CRUD/编号预填/价格脱敏/类别新增);导入解析契约由 materialImport.test.ts 覆盖。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MaterialMasterPage from "@/pages/MaterialMasterPage";

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "物料资料", 打开: true, 保存: true, 删除: true, 单价: true },
  { 组: "基础资料", 菜单: "物料类别", 保存: true },
];

const ROW = {
  id: 1, ID: 1, 物料编号: "MAT-1", 物料名称: "彩盒", 物料类别: "纸品", 规格: "S",
  颜色: "白", 单位: "盒", 单价: 2.5, 销售价: 3, 库存: 100, 最低库存: 10,
  供应商名称: "供应商一", 备注: "备注一",
};

const CATS = [
  { 编号: "纸品", 类别: "纸品", 数量: 3, 父级: null },
  { 编号: "五金", 类别: "五金", 数量: 2, 父级: null },
];

interface Cfg {
  perms?: unknown;
  list?: unknown;
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
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms ?? PERMS_FULL));
      if (p === "/api/material-master/categories") return json(CATS);
      if (p === "/api/material-master/next-code") return json({ 编号: "MAT-AUTO-1" });
      if (p === "/api/material-master" && method === "GET")
        return json(cfg.list ?? { items: [ROW], total: 1 });
      if (p === "/api/material-master" && method === "POST") return json({ id: 2 });
      if (p === "/api/master/material-categories" && method === "POST") return json({ id: 3 });
      if (p === "/api/master/warehouse-locations") return json({ items: [], total: 0 });
      if (p === "/api/master/materials/1" && method === "GET") return json({ ...ROW, 仓库位置: "A-01" });
      if (/^\/api\/master\/materials\/\d+$/.test(p) && method === "PUT") return json(body);
      if (/^\/api\/master\/materials\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg = {}) => {
  const calls = installFetch(cfg);
  renderWithProviders(<MaterialMasterPage />, "/material-master");
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("MAT-1")).toBeInTheDocument());

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("物料资料", () => {
  it("列表 + 类别树渲染(带数量),价格列显示", async () => {
    setup();
    await waitList();
    expect(screen.getByText("彩盒")).toBeInTheDocument();
    expect(screen.getByText("2.5")).toBeInTheDocument();
    expect(screen.getByText("纸品(3)")).toBeInTheDocument();
    expect(screen.getByText("五金(2)")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("选中类别:列表按 类别 参数过滤", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("五金(2)"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/material-master?") && decodeURIComponent(c.url).includes("类别=五金")),
      ).toBe(true),
    );
  });

  it("无 单价 权限位:价格列脱敏为 ***", async () => {
    setup({
      perms: [
        { 组: "基础资料", 菜单: "物料资料", 打开: true, 保存: true, 删除: true, 单价: false },
        { 组: "基础资料", 菜单: "物料类别", 保存: true },
      ],
    });
    await waitList();
    expect(screen.getAllByText("***").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("2.5")).not.toBeInTheDocument();
  });

  it("新增:编号由 next-code 预填,保存 POST /material-master(带默认货币)", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("新增"));
    await waitFor(() => expect(screen.getByLabelText("物料编号")).toHaveValue("MAT-AUTO-1"));
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "新料" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/material-master" &&
            c.body?.物料编号 === "MAT-AUTO-1" &&
            c.body?.物料名称 === "新料" &&
            c.body?.货币 === "HK$",
        ),
      ).toBe(true),
    );
  });

  it("双击选中后编辑:GET 详情预填,保存 PUT /master/materials/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("MAT-1"));
    fireEvent.click(screen.getByText("编辑"));
    await waitFor(() => expect(screen.getByLabelText("仓库位置")).toHaveValue("A-01"));
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "彩盒大" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/master/materials/1" && c.body?.物料名称 === "彩盒大",
        ),
      ).toBe(true),
    );
  });

  it("删除:确认后 DELETE /master/materials/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("MAT-1"));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /确认删除/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/master/materials/1")).toBe(true),
    );
  });

  it("新增子类别:挂到当前选中类别下(POST /master/material-categories)", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("五金(2)"));
    fireEvent.click(screen.getByText("新增子类别"));
    await waitFor(() => expect(screen.getByLabelText("类别名称")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("类别名称"), { target: { value: "螺丝" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/material-categories" &&
            c.body?.编号 === "螺丝" &&
            c.body?.类别 === "五金",
        ),
      ).toBe(true),
    );
  });

  it("导入表格/打印条码入口可打开", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getByText("导入表格"));
    await waitFor(() =>
      expect(screen.getAllByText("导入物料表格").length).toBeGreaterThanOrEqual(1),
    );
    fireEvent.click(screen.getByText("取消"));
    fireEvent.click(screen.getByText("打印条码"));
    await waitFor(() =>
      expect(screen.getAllByText("条码标签打印").length).toBeGreaterThanOrEqual(1),
    );
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup({ perms: [] });
    await waitFor(() => expect(screen.getByText("无权访问物料资料")).toBeInTheDocument());
  });
});
