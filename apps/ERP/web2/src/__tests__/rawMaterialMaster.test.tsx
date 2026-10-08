// 原料资料页:对照老系统 web/src/pages/plastics/PlasticRawMaterialMasterPage.tsx。
// 场景:类别树+列表渲染;新增校验(物料编号必填)与 POST /master/plastic-raw-materials;
// 编辑先 GET 详情再 PUT;删除走确认弹窗 DELETE;无「单价」位 价格列脱敏 *** 且弹窗不出价格字段。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticRawMaterialMasterPage from "@/pages/PlasticRawMaterialMasterPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "塑胶原料资料表", 打开: true, 保存: true, 删除: true, 单价: true },
];
const PERMS_NO_PRICE = [
  { 组: "基础资料", 菜单: "塑胶原料资料表", 打开: true, 保存: true, 删除: true, 单价: false },
];

const ROW = {
  ID: 7,
  物料编号: "RM-ABS-001",
  物料名称: "ABS 757",
  物料类别: "ABS",
  规格: "25KG/包",
  颜色: "本色",
  商品名称: "ABS料",
  产地: "台湾",
  每包重量: 25,
  单位: "KG",
  单价: 12.5,
  销售价: 15,
  起订量: 500,
  安全库存: 200,
  库存: 350,
  供应商名称: "台化",
  备注: "常用",
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown[] = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-raw-material-master/categories")
        return json([{ 类别: "ABS", 数量: 2 }, { 类别: "PVC", 数量: 1 }]);
      if (p === "/api/plastic-raw-material-master") return json({ items: [ROW], total: 1 });
      if (p === "/api/master/plastic-raw-materials/7") {
        if (init?.method === "PUT") return json({});
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return json(ROW);
      }
      if (p === "/api/master/plastic-raw-materials" && init?.method === "POST")
        return json({ ...ROW, ID: 8 });
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

describe("PlasticRawMaterialMasterPage(原料资料)", () => {
  it("类别树(全部塑胶原料+类别(数量)) + 列表行渲染", async () => {
    installFetch();
    renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
    await screen.findByText("RM-ABS-001");
    expect(screen.getByText("全部塑胶原料")).toBeInTheDocument();
    expect(screen.getAllByText("ABS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PVC").length).toBeGreaterThan(0);
    expect(screen.getByText("ABS 757")).toBeInTheDocument();
    expect(screen.getByText("台湾")).toBeInTheDocument();
    expect(screen.getByText("台化")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("点类别下发 类别 过滤参数", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
    await screen.findByText("RM-ABS-001");
    fireEvent.click(screen.getAllByText("PVC")[0]);
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/plastic-raw-material-master?") && c.url.includes("%E7%B1%BB%E5%88%AB=PVC")),
      ).toBe(true),
    );
  });

  it("新增:物料编号必填校验;填齐后 POST,数值字段转 Number", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
    await screen.findByText("RM-ABS-001");
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await screen.findByText("请输入物料编号");
    expect(calls.some((c) => c.url.endsWith("/master/plastic-raw-materials") && c.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "RM-NEW-1" } });
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "新料" } });
    fireEvent.change(screen.getByLabelText("每包重量"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/master/plastic-raw-materials") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.物料编号).toBe("RM-NEW-1");
      expect(body.每包重量).toBe(25);
    });
    await screen.findByText("已保存");
  });

  it("编辑:先 GET 详情再 PUT;删除:确认弹窗后 DELETE", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
    await screen.findByText("RM-ABS-001");
    fireEvent.click(screen.getByRole("button", { name: "编辑 RM-ABS-001" }));
    await screen.findByRole("dialog");
    expect(calls.some((c) => c.url.endsWith("/master/plastic-raw-materials/7") && c.method === "GET")).toBe(true);
    expect(screen.getByLabelText("物料名称")).toHaveValue("ABS 757");
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "ABS 757 改" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const put = calls.find(
        (c) => c.url.endsWith("/master/plastic-raw-materials/7") && c.method === "PUT",
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.body!).物料名称).toBe("ABS 757 改");
    });
    await screen.findByText("已保存");
    fireEvent.click(screen.getByRole("button", { name: "删除 RM-ABS-001" }));
    await screen.findByText(/确认删除该塑胶原料/);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/master/plastic-raw-materials/7") && c.method === "DELETE"),
      ).toBe(true),
    );
    await screen.findByText("已删除");
  });

  it("无「单价」位:单价/销售价列显 ***,编辑弹窗不出价格字段", async () => {
    installFetch(PERMS_NO_PRICE);
    renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
    await screen.findByText("RM-ABS-001");
    expect(screen.getAllByText("***").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "编辑 RM-ABS-001" }));
    await screen.findByRole("dialog");
    expect(screen.queryByLabelText("单价")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("销售价")).not.toBeInTheDocument();
  });

  it("无「打开」权限:整页无权提示", async () => {
    installFetch([]);
    renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
    await screen.findByText("无权访问该页面");
  });
});
