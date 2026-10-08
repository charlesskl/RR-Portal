// BOM物料查询页:场景对照老系统 web/src/pages/production/BomMaterialQueryPage.tsx
// (关键字查询/款号跳转/物料资料查看弹窗/半成品组成弹窗含 MA 回落)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import BomMaterialQueryPage from "@/pages/BomMaterialQueryPage";

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "业务单据", 菜单: "生产制单", 打开: true }];

const ROWS = [
  { 款号: "K001", 款式: "毛绒熊", 物料编号: "M-1", 物料名称: "彩盒", 物料类别: "纸品", 规格: "S", 颜色: "白", 单位: "盒", 使用数量: 1 },
  { 款号: "K001", 款式: "毛绒熊", 物料编号: "SEMI-A", 物料名称: "子件单", 物料类别: "半成品", 规格: "", 颜色: "", 单位: "PCS", 使用数量: 2 },
];

interface Cfg {
  perms?: unknown;
  semiDefs?: unknown;
  view?: unknown;
  materials?: unknown;
}

function installFetch(cfg: Cfg = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url, method: "GET" });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms ?? PERMS_FULL));
      if (p === "/api/production-reports/bom-materials") return json(ROWS);
      if (p === "/api/semi-setups") return json(cfg.semiDefs ?? []);
      if (p === "/api/master/materials")
        return json(cfg.materials ?? { items: [{ id: 1, 物料编号: "M-1", 物料名称: "彩盒", 规格: "S", 物料类别: "纸品" }], total: 1 });
      const m = /^\/api\/styles\/(.+?)\/materials$/.exec(p);
      if (m) return json(cfg.view ?? { 款号: "K001", 款式: "毛绒熊", 物料: [], 单头: null });
      return json({ 消息: `unhandled ${p}` }, 404);
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
        <Route path="/bom-material-query" element={<BomMaterialQueryPage />} />
        <Route path="/bom-setup" element={<div>BOM设置页STUB</div>} />
      </Routes>
    </>,
    "/bom-material-query",
  );
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("彩盒")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("BOM物料查询", () => {
  it("渲染明细行 + 共 N 条", async () => {
    setup();
    await waitList();
    expect(screen.getByText("子件单")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });

  it("查询:关键字进入查询参数", async () => {
    const calls = setup();
    await waitList();
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "彩盒" } });
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
      expect(
        calls.some((c) => decodeURIComponent(c.url).includes("/api/production-reports/bom-materials?keyword=彩盒")),
      ).toBe(true),
    );
  });

  it("点款号跳 BOM物料设置", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getAllByText("K001")[0]);
    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=K001"));
  });

  it("普通物料行:点名称弹 产品资料查询A(物料资料)", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getByText("彩盒"));
    await waitFor(() =>
      expect(screen.getAllByText("产品资料查询A · 物料资料").length).toBeGreaterThanOrEqual(1),
    );
    await waitFor(() =>
      expect(screen.getAllByText("彩盒").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("半成品行:点名称弹半成品组成(本货号定义命中)", async () => {
    setup({
      semiDefs: [
        { ID: 1, 货号: "K001", 名称: "子件单", 类型: "半成品", 顺序: 1, 创建时间: "", 明细: [{ 物料编号: "M-9", 物料名称: "内衬", 使用数量: 4 }] },
      ],
    });
    await waitList();
    fireEvent.click(screen.getByText("子件单"));
    await waitFor(() =>
      expect(screen.getAllByText(/半成品组成 · 子件单/).length).toBeGreaterThanOrEqual(1),
    );
    await waitFor(() => expect(screen.getByText("内衬")).toBeInTheDocument());
  });

  it("半成品行:本货号无定义时回落关联 MA 货号的定义", async () => {
    const cfg: Cfg = {
      view: { 款号: "K001", 款式: "毛绒熊", 物料: [], 单头: { MA货号: "K001-MA" } },
    };
    const calls = setup(cfg);
    await waitList();
    // semiDefs 默认空 → 触发 MA 回落;回落后再查 semi-setups 仍空 → 提示未找到
    fireEvent.click(screen.getByText("子件单"));
    await waitFor(() =>
      expect(screen.getByText(/未找到「子件单」的半成品设置/)).toBeInTheDocument(),
    );
    // 验证确实先查本货号定义、再读单头 MA货号、再查 MA 货号定义
    expect(
      calls.some((c) => decodeURIComponent(c.url).includes("/api/styles/K001/materials")),
    ).toBe(true);
    const semiQueries = calls.filter((c) => decodeURIComponent(c.url).startsWith("/api/semi-setups"));
    expect(semiQueries.length).toBeGreaterThanOrEqual(2);
    expect(decodeURIComponent(semiQueries[1].url)).toContain("货号=K001-MA");
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup({ perms: [] });
    await waitFor(() => expect(screen.getByText("无权访问 BOM物料查询")).toBeInTheDocument());
  });
});
