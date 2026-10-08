// 款号总表:场景对照老系统 web/src/pages/master/MasterDataPage.tsx(款号资料 配置)
// 与 web/src/__tests__/master.test.ts(masterApi 路径契约:/master/styles CRUD)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import StyleMasterPage from "@/pages/StyleMasterPage";

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: true, 删除: true, 单价: true },
];

const ROW = {
  id: 1, 款号: "92125A", 款式: "毛绒熊", 单价: 12.5, 成本价: 8, 批发价: 10, 零售价: 15,
};

interface Cfg {
  perms?: unknown;
  list?: unknown;
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
      calls.push({ url, method, body });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms ?? PERMS_FULL));
      if (p === "/api/master/styles" && method === "GET")
        return json(cfg.list ?? { items: [ROW], total: 1 });
      if (p === "/api/master/styles" && method === "POST") return json({ id: 2, ...body });
      if (/^\/api\/master\/styles\/\d+$/.test(p) && method === "PUT") return json(body);
      if (/^\/api\/master\/styles\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

let lastLoc = "";
function Probe() {
  const l = useLocation();
  useEffect(() => {
    lastLoc = l.pathname + l.search;
  }, [l]);
  return null;
}

const setup = (cfg: Cfg = {}) => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/master/款号资料" element={<StyleMasterPage />} />
        <Route path="/bom-setup" element={<div>BOM设置页STUB</div>} />
      </Routes>
    </>,
    "/master/款号资料",
  );
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("92125A")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("款号总表", () => {
  it("列表渲染字段(含价格列),底部共 N 条", async () => {
    setup();
    await waitList();
    for (const h of ["款号", "款式", "单价", "成本价", "批发价", "零售价"])
      expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("毛绒熊")).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("无 单价 权限位:价格列隐藏", async () => {
    setup({
      perms: [{ 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: true, 删除: true, 单价: false }],
    });
    await waitList();
    expect(screen.queryByText("成本价")).not.toBeInTheDocument();
    expect(screen.queryByText("12.5")).not.toBeInTheDocument();
    expect(screen.getByText("款号")).toBeInTheDocument();
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup({ perms: [] });
    await waitFor(() => expect(screen.getByText("无权访问款号总表")).toBeInTheDocument());
  });

  it("双击行选中后可编辑:编辑弹窗预填,保存 PUT /master/styles/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("92125A"));
    expect(screen.getByText(/已选中:92125A/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("编辑"));
    await waitFor(() => expect(screen.getByLabelText("款式")).toHaveValue("毛绒熊"));
    fireEvent.change(screen.getByLabelText("款式"), { target: { value: "毛绒熊二代" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/master/styles/1" && c.body?.款式 === "毛绒熊二代",
        ),
      ).toBe(true),
    );
  });

  it("新增:POST /master/styles", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("新增"));
    fireEvent.change(screen.getByLabelText("款号"), { target: { value: "NEW-1" } });
    fireEvent.change(screen.getByLabelText("款式"), { target: { value: "新款" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url === "/api/master/styles" && c.body?.款号 === "NEW-1",
        ),
      ).toBe(true),
    );
  });

  it("删除:确认后 DELETE /master/styles/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("92125A"));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /确认删除/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/master/styles/1")).toBe(true),
    );
  });

  it("明细:跳 BOM物料设置页打开该货号", async () => {
    setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("92125A"));
    fireEvent.click(screen.getByText("明细"));
    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=92125A"));
  });
});
