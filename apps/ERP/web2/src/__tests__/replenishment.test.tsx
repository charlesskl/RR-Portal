// 补料单页:对照老系统 web/src/pages/replenishment/ReplenishmentPage.tsx +
// web/src/__tests__/replenishment.test.ts(validateReplenishment 纯函数逐条移植)。
// 场景:列表渲染/审核状态筛选/关键字、无权访问、审核确认流(弹窗文案带 PMC)、
// 新建校验(空明细/PMC 必选)、新建保存载荷(仓库/PMC/明细/数量手填)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { validateReplenishment, type ReplenishDraftLine } from "@/lib/replenishment";
import ReplenishmentPage from "@/pages/ReplenishmentPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "补料管理", 菜单: "补料单", 打开: true, 保存: true, 删除: true, 审核: true }];

const HEADERS = [
  {
    ID: 1, 单号: "BL20260901001", 日期: "2026-09-01", 部门: "装配部", 生产单号: "MO-1",
    款号: "K-1", 仓库: "来料仓", 数量: 15, 操作员: "op1", PMC: "张三",
    审核: "0", 审核人: null, 备注: "急补",
  },
  {
    ID: 2, 单号: "BL20260902001", 日期: "2026-09-02", 部门: "包装部", 生产单号: null,
    款号: null, 仓库: "塑胶仓", 数量: 3, 操作员: "op2", PMC: "李四",
    审核: "1", 审核人: "仓管王", 已采购: "1", 备注: null,
  },
];

const DETAIL = {
  单头: { ...HEADERS[0] },
  明细: [
    { ID: 11, 物料编号: "M-001", 物料名称: "布料", 规格: "S", 颜色: "红", 单位: "米", 数量: 15, 备注: "" },
  ],
};

type Call = { url: string; method: string; body?: string };

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/replenishments" && (init?.method ?? "GET") === "GET")
        return json({ items: HEADERS, total: 2 });
      if (p === "/api/replenishments" && init?.method === "POST") return json({ 单号: "BL20260918001" });
      if (p === "/api/replenishments/BL20260901001") return json(DETAIL);
      if (p.endsWith("/audit") || p.endsWith("/reverse-audit") || p.endsWith("/mark-purchased"))
        return new Response(null, { status: 204 });
      if (p === "/api/master/departments")
        return json({ items: [{ 部门: "装配部" }, { 部门: "包装部" }], total: 2 });
      if (p === "/api/master/employees")
        return json({ items: [{ 姓名: "张三", 职称: "PMC" }, { 姓名: "王五", 职称: "仓管" }], total: 2 });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------- 纯函数(对照 web/src/__tests__/replenishment.test.ts) ----------

const line = (p: Partial<ReplenishDraftLine>): ReplenishDraftLine => ({
  key: 0,
  物料编号: "",
  数量: 0,
  ...p,
});

describe("validateReplenishment", () => {
  it("仓库必须是来料仓/塑胶仓", () => {
    expect(validateReplenishment({ 仓库: "半成品仓", 明细: [line({ 物料编号: "A", 数量: 1 })] })).toBe(
      "请选择仓库（来料仓/塑胶仓）。",
    );
    expect(validateReplenishment({ 明细: [line({ 物料编号: "A", 数量: 1 })] })).toBe(
      "请选择仓库（来料仓/塑胶仓）。",
    );
  });
  it("至少一行有效明细(空白物料编号不计)", () => {
    expect(validateReplenishment({ 仓库: "来料仓", 明细: [] })).toBe("请至少录入一行补料物料。");
    expect(
      validateReplenishment({ 仓库: "来料仓", 明细: [line({ 物料编号: "  ", 数量: 1 })] }),
    ).toBe("请至少录入一行补料物料。");
  });
  it("数量必须大于0", () => {
    expect(validateReplenishment({ 仓库: "塑胶仓", 明细: [line({ 物料编号: "A", 数量: 0 })] })).toBe(
      "物料 A 的补料数量必须大于 0。",
    );
  });
  it("通过返回 null", () => {
    expect(validateReplenishment({ 仓库: "来料仓", 明细: [line({ 物料编号: "A", 数量: 1 })] })).toBeNull();
    expect(
      validateReplenishment({
        仓库: "塑胶仓",
        明细: [line({ 物料编号: "", 数量: 0 }), line({ 物料编号: "B", 数量: 2 })],
      }),
    ).toBeNull();
  });
});

// ---------- 页面 ----------

describe("ReplenishmentPage", () => {
  it("渲染列表行:状态/已采购徽章/数量;默认带 page/size 参数", async () => {
    installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    expect(screen.getByText("BL20260902001")).toBeInTheDocument();
    // 已审核徽章(行2)+ 审核状态下拉选项同文案,断言至少一处
    expect(screen.getAllByText("已审核").length).toBeGreaterThan(0);
    expect(screen.getAllByText("未审核").length).toBeGreaterThan(0);
    expect(screen.getByText("已采购")).toBeInTheDocument();
    expect(screen.getByText("共 2 条,第 1 / 1 页")).toBeInTheDocument();
  });

  it("关键字/审核状态进查询参数", async () => {
    const calls = installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "MO-1" } });
    pickOption("审核状态", "未审核");
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() => {
      const hit = calls.find(
        (c) =>
          c.url.startsWith("/api/replenishments?") &&
          c.url.includes("keyword=MO-1") &&
          c.url.includes("%E5%AE%A1%E6%A0%B8%E6%83%85%E5%86%B5"),
      );
      expect(hit).toBeTruthy();
    });
  });

  it("审核流:弹窗文案带 PMC,确认后 POST audit 并重取列表", async () => {
    const calls = installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    // 确认弹窗文案对照老系统 Popconfirm
    await screen.findByText(/审核后补料单将发送给 PMC「张三」安排采购/);
    fireEvent.click(screen.getByRole("button", { name: "确认审核" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/replenishments/BL20260901001/audit" && c.method === "POST"),
      ).toBe(true);
    });
    await screen.findByText(/已审核\(已通知所选 PMC 安排采购\)/);
  });

  it("已审核单只给反审核,不给删除;未审核单给删除", async () => {
    installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(1); // 仅未审核那张
  });

  it("无「打开」权限:整页无权提示,不发列表请求", async () => {
    const calls = installFetch([]);
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("无权访问该页面");
    expect(calls.some((c) => c.url.startsWith("/api/replenishments?"))).toBe(false);
  });

  it("新建:空明细保存被前端拦(请至少录入一行补料物料)", async () => {
    const calls = installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    fireEvent.click(screen.getByRole("button", { name: /新建补料单/ }));
    await screen.findByRole("button", { name: "按生产单带出物料" });
    // 部门选项加载后默认 装配部;PMC 必选,先选上
    await waitFor(() => expect(screen.getByLabelText("部门")).toHaveTextContent("装配部"));
    pickOption("PMC", "张三");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行补料物料。");
    expect(calls.some((c) => c.url === "/api/replenishments" && c.method === "POST")).toBe(false);
  });

  it("新建:PMC 必选(不选先报 PMC 校验)", async () => {
    installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    fireEvent.click(screen.getByRole("button", { name: /新建补料单/ }));
    await screen.findByRole("button", { name: "按生产单带出物料" });
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    const codeInput = screen.getByLabelText("物料编号");
    fireEvent.change(codeInput, { target: { value: "M-100" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择PMC");
  });

  it("新建保存:载荷带 部门/仓库/PMC/明细(数量手填),成功后关窗重取", async () => {
    const calls = installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    await screen.findByText("BL20260901001");
    fireEvent.click(screen.getByRole("button", { name: /新建补料单/ }));
    await screen.findByRole("button", { name: "按生产单带出物料" });
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: " M-100 " } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "5" } });
    await waitFor(() => expect(screen.getByLabelText("部门")).toHaveTextContent("装配部"));
    pickOption("PMC", "张三");
    fireEvent.change(screen.getByLabelText("生产单号"), { target: { value: "MO-9" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/replenishments" && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.部门).toBe("装配部"); // 部门默认 装配部(对照老系统)
      expect(body.仓库).toBe("来料仓");
      expect(body.PMC).toBe("张三");
      expect(body.生产单号).toBe("MO-9");
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 物料编号: "M-100", 数量: 5 });
    });
    await screen.findByText(/补料单 BL20260918001 已保存/);
  });

  it("明细弹窗:点单号打开整单,显示单头与明细行", async () => {
    installFetch();
    renderWithProviders(<ReplenishmentPage />, "/replenishments");
    const noLink = await screen.findByText("BL20260901001");
    fireEvent.click(noLink);
    await waitFor(() => expect(screen.getAllByText("补料单明细 BL20260901001").length).toBeGreaterThan(0));
    expect(screen.getByText("M-001")).toBeInTheDocument();
    expect(screen.getByText("布料")).toBeInTheDocument();
  });
});
