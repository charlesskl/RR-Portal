// 装配需领明细表页:场景对照老系统 web/src/pages/assembly/AssemblyRequiredMaterialDetailPage.tsx
// (收货仓库/类型/审核情况筛选,双击跳装配加工采购单,无权访问)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import AssemblyRequiredMaterialDetailPage from "@/pages/AssemblyRequiredMaterialDetailPage";

type Call = { url: string; method: string };

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "款号资料", 打开: true }];

const ROWS = [
  {
    日期: "2026-09-05", 单号: "SLB2601122", 收货仓库: "半成品仓", 供应商编号: "SUP-1",
    供应商名称: "龙昌加工厂", 产品货号: "DS2609", 产品装配名称: "恐龙套装",
    装配方式: "组装半成品", 生产单号: "MO-1", 物料编号: "MAT-1", 物料名称: "彩盒",
    需领数量: 1000, 审核: "1",
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
      if (p === "/api/assembly-purchase-query/required-materials") return json(rows);
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

const setup = (perms?: unknown, rows?: unknown) => {
  const calls = installFetch(perms, rows);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route
          path="/assembly-required-material-detail"
          element={<AssemblyRequiredMaterialDetailPage />}
        />
        <Route path="/assembly-purchases" element={<div>装配加工采购单STUB</div>} />
      </Routes>
    </>,
    "/assembly-required-material-detail",
  );
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("SLB2601122")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("装配需领明细表", () => {
  it("渲染行:单号/供应商/产品/物料/需领数量;审核映射", async () => {
    setup();
    await waitList();
    expect(screen.getByText("恐龙套装")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("已审核")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("类型/审核情况/收货仓库进查询参数;全部不下发", async () => {
    const calls = setup();
    await waitList();
    const first = calls.find((c) => c.url.includes("/required-materials?"));
    expect(first?.url).not.toContain("%E7%B1%BB%E5%9E%8B="); // 类型
    pickOption("类型", "半成品");
    pickOption("审核情况", "未审核");
    pickOption("收货仓库", "成品仓");
    await waitFor(() => {
      const hit = calls.findLast((c) => c.url.includes("/required-materials?"));
      expect(hit?.url).toContain("%E7%B1%BB%E5%9E%8B=%E5%8D%8A%E6%88%90%E5%93%81");
      expect(hit?.url).toContain("%E5%AE%A1%E6%A0%B8%E6%83%85%E5%86%B5=%E6%9C%AA%E5%AE%A1%E6%A0%B8");
      expect(hit?.url).toContain("%E6%94%B6%E8%B4%A7%E4%BB%93%E5%BA%93=%E6%88%90%E5%93%81%E4%BB%93");
    });
  });

  it("双击行跳装配加工采购单整单", async () => {
    setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("恐龙套装"));
    await waitFor(() => expect(lastLoc).toBe("/assembly-purchases?单号=SLB2601122"));
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() =>
      expect(screen.getByText("无权访问 装配需领明细表")).toBeInTheDocument(),
    );
  });
});
