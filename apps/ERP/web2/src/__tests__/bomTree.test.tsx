// BOM层级树页:上级链 + BOM/半成品/物料 嵌套树渲染;BOM 节点跳 /bom-setup?款号=;
// 上级链节点点击重查;权限 gate=生产制单·打开。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import BomTreePage from "@/pages/BomTreePage";

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "业务单据", 菜单: "生产制单", 打开: true }];

const TREE = {
  货号: "92125-01",
  上级链: [{ 款号: "92125-MA", MA货号: null, 款式: "猫公仔模板", 审核: "1" }],
  树: {
    类型: "BOM",
    编号: "92125-01",
    名称: "猫公仔实单",
    副标题: "ZURU",
    审核: "1",
    明细行数: 3,
    下级: [
      {
        类型: "半成品",
        编号: "配件包",
        名称: "配件包",
        用量: 1,
        下级: [
          { 类型: "物料", 编号: "M-1", 名称: "珠子", 副标题: "红 / 大", 用量: 5 },
          {
            类型: "半成品",
            编号: "内芯",
            名称: "内芯",
            用量: 2,
            下级: [{ 类型: "物料", 编号: "M-2", 名称: "纸卡", 用量: 1 }],
          },
        ],
      },
      { 类型: "BOM", 编号: "92125-01-A", 名称: "子实单", 审核: "0", 明细行数: 1, 下级: [] },
    ],
  },
};

function installFetch(perms: unknown = PERMS_FULL, tree: unknown = TREE) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/production-reports/bom-tree") return json(tree);
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

const setup = (perms?: unknown, tree?: unknown, start = "/bom-tree?款号=92125-01") => {
  const calls = installFetch(perms, tree);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/bom-tree" element={<BomTreePage />} />
        <Route path="/bom-setup" element={<div>BOM设置页STUB</div>} />
      </Routes>
    </>,
    start,
  );
  return calls;
};

const waitTree = () => waitFor(() => expect(screen.getByText("猫公仔实单")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("BOM层级树", () => {
  it("渲染:上级链 + 嵌套树(半成品/物料/子BOM),用量与审核徽标", async () => {
    setup();
    await waitTree();
    // 上级链
    expect(screen.getByText("上级链")).toBeInTheDocument();
    expect(screen.getByText("92125-MA")).toBeInTheDocument();
    // 嵌套半成品与物料(默认展开)
    expect(screen.getByText("配件包")).toBeInTheDocument();
    expect(screen.getByText("内芯")).toBeInTheDocument();
    expect(screen.getByText("珠子")).toBeInTheDocument();
    expect(screen.getByText("纸卡")).toBeInTheDocument();
    // 子实单 BOM 节点
    expect(screen.getByText("92125-01-A")).toBeInTheDocument();
    // 审核徽标
    expect(screen.getByText("已审核")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();
  });

  it("折叠:点收起后下级隐藏", async () => {
    setup();
    await waitTree();
    const collapseBtns = screen.getAllByLabelText("收起");
    fireEvent.click(collapseBtns[0]);
    expect(screen.queryByText("配件包")).not.toBeInTheDocument();
  });

  it("点 BOM 节点跳 BOM物料设置 打开该货号", async () => {
    setup();
    await waitTree();
    fireEvent.click(screen.getByText("92125-01-A"));
    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=92125-01-A"));
  });

  it("点上级链节点:以该货号重新查询", async () => {
    const calls = setup();
    await waitTree();
    fireEvent.click(screen.getByText("92125-MA"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("/api/production-reports/bom-tree") &&
            decodeURIComponent(c.url).includes("货号=92125-MA"),
        ),
      ).toBe(true),
    );
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText("无权访问 BOM层级树")).toBeInTheDocument());
  });

  it("未输入货号:提示输入,不发请求", async () => {
    const calls = setup(PERMS_FULL, TREE, "/bom-tree");
    await waitFor(() => expect(screen.getByText("输入货号后查询")).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("bom-tree"))).toBe(false);
  });
});
