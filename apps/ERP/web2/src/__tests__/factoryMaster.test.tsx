// 加工厂资料页:对照老系统 web/src/pages/master/FactoryMasterPage.tsx。
// 左树类别(全部加工厂 + 类别(数量))/选中类别带 类别 参数重查/搜索/新增(默认带选中类别,编号必填)/
// 双击选中+编辑(GET /master/factories/{id} 详情预填,PUT 保存)/删除/无打开位提示。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import FactoryMasterPage from "@/pages/FactoryMasterPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "加工厂资料", 打开: true, 保存: true, 删除: true }];

const ROW = {
  id: 1, 加工厂编号: "F001", 加工厂名称: "凯福适", 加工厂类别: "喷油", 联系地址: "东莞",
  联系人: "李四", 电话: "0769-111", 手机: "13900000000", 传真: "0769-222", 货币: "RMB", 付款方式: "月结", 备注: "老厂",
};

const CATS = [
  { 类别: "喷油", 数量: 3 },
  { 类别: "移印", 数量: 2 },
];

type Call = { url: string; method: string; body?: Record<string, unknown> };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/factory-master/categories") return json(CATS);
      if (p === "/api/factory-master" && method === "GET") return json({ items: [ROW], total: 1 });
      if (p === "/api/master/factory-categories") return json({ items: [{ id: 9, 类别: "喷油", 名称: "喷油" }, { id: 10, 类别: "移印", 名称: "移印" }], total: 2 });
      if (p === "/api/master/factories" && method === "POST") return json({ id: 2 });
      if (p === "/api/master/factories/1" && method === "GET") return json(ROW);
      if (/^\/api\/master\/factories\/\d+$/.test(p) && method === "PUT") return json(body);
      if (/^\/api\/master\/factories\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms);
  renderWithProviders(<FactoryMasterPage />, "/master/加工厂资料");
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("F001")).toBeInTheDocument());

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FactoryMasterPage", () => {
  it("列表 + 左树类别(带数量)渲染", async () => {
    setup();
    await waitList();
    expect(screen.getByText("凯福适")).toBeInTheDocument();
    expect(screen.getByText("全部加工厂")).toBeInTheDocument();
    expect(screen.getByText("喷油(3)")).toBeInTheDocument();
    expect(screen.getByText("移印(2)")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("选中类别:列表按 类别 参数过滤并回第 1 页", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("移印(2)"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/factory-master?") && decodeURIComponent(c.url).includes("类别=移印")),
      ).toBe(true),
    );
  });

  it("新增:默认带当前选中类别,编号必填,保存 POST /master/factories", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("喷油(3)"));
    await waitFor(() =>
      expect(calls.some((c) => decodeURIComponent(c.url).includes("类别=喷油"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    await waitFor(() => expect(screen.getByLabelText("加工厂编号")).toBeInTheDocument());
    expect(screen.getByLabelText("加工厂类别")).toHaveTextContent("喷油");
    // 编号必填:空编号不提交
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await screen.findByText("请输入加工厂编号");
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/master/factories")).toBe(false);
    fireEvent.change(screen.getByLabelText("加工厂编号"), { target: { value: "F002" } });
    fireEvent.change(screen.getByLabelText("加工厂名称"), { target: { value: "新厂" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/factories" &&
            c.body?.加工厂编号 === "F002" &&
            c.body?.加工厂类别 === "喷油",
        ),
      ).toBe(true),
    );
  });

  it("双击选中后编辑:GET 详情预填,保存 PUT /master/factories/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("F001"));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() => expect(screen.getByLabelText("加工厂名称")).toHaveValue("凯福适"));
    fireEvent.change(screen.getByLabelText("加工厂名称"), { target: { value: "凯福适二厂" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/master/factories/1" && c.body?.加工厂名称 === "凯福适二厂",
        ),
      ).toBe(true),
    );
  });

  it("删除:确认后 DELETE /master/factories/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("F001"));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /确认删除/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/master/factories/1")).toBe(true),
    );
  });

  it("无「打开」位:无权访问提示", async () => {
    setup([{ 组: "基础资料", 菜单: "加工厂资料" }]);
    await screen.findByText("无权访问加工厂资料");
  });
});
