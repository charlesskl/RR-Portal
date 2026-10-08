// 塑胶共用物料表页:对照老系统 web/src/pages/plastics/PlasticCommonMaterialPage.tsx。
// 纯函数(validate套数 套数=出模数÷用量 规则 / commonFormToPayload 数值空串转 null /
// secondProcess 二次加工类别后缀,对照老系统 web/src/utils/secondProcess.ts 注释规则)
// + 页面(筛选参数/双击选中/新增弹窗/套数校验拦截/保存 POST 载荷/价格字段按「单价」位显隐/删除确认)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import {
  commonFormToPayload,
  validate套数,
  EMPTY_COMMON_FORM,
  套数规则提示,
} from "@/lib/plasticCommonMaterial";
import { 二次加工字母, 二次加工类别后缀 } from "@/lib/secondProcess";
import PlasticCommonMaterialPage from "@/pages/PlasticCommonMaterialPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

describe("塑胶共用物料表·纯函数", () => {
  it("validate套数:套数=出模数÷用量(4 位取舍);用量 0 报错;缺参不校验", () => {
    const base = { ...EMPTY_COMMON_FORM };
    expect(validate套数({ ...base, 出模数: "8", 用量: "2", 套数: "4" })).toBeNull();
    expect(validate套数({ ...base, 出模数: "8", 用量: "2", 套数: "5" })).toBe(套数规则提示);
    expect(validate套数({ ...base, 出模数: "8", 用量: "0", 套数: "4" })).toBe(套数规则提示);
    expect(validate套数({ ...base, 出模数: "", 用量: "2", 套数: "4" })).toBeNull();
    expect(validate套数({ ...base, 套数: "" })).toBeNull();
    // 4 位取舍:7/3=2.3333
    expect(validate套数({ ...base, 出模数: "7", 用量: "3", 套数: "2.3333" })).toBeNull();
  });

  it("commonFormToPayload:数值字段空串=null,文本空串不带", () => {
    const body = commonFormToPayload({
      ...EMPTY_COMMON_FORM,
      塑胶货号: "PH-1",
      客户: "  客户A ",
      套数: "4",
      用量: "",
    });
    expect(body.塑胶货号).toBe("PH-1");
    expect(body.客户).toBe("客户A");
    expect(body.套数).toBe(4);
    expect(body.用量).toBeNull();
    expect(body.物料名称).toBeUndefined(); // 空文本不带
  });

  it("二次加工类别后缀:BD=电镀+印喷(顺序容错),AF=印喷+植绒,AH=印喷+植发", () => {
    expect(二次加工类别后缀("电镀", "印喷")).toBe("BD");
    expect(二次加工类别后缀("喷油", "电镀")).toBe("BD"); // 喷油视同印喷
    expect(二次加工类别后缀("移印", "植绒")).toBe("AF");
    expect(二次加工类别后缀("印喷", "植发")).toBe("AH");
    expect(二次加工类别后缀("电镀", "植绒")).toBeNull();
    expect(二次加工类别后缀("喷油", "")).toBeNull();
    expect(二次加工类别后缀("喷油", "移印")).toBeNull(); // 同工序
    expect(二次加工字母("BD", "电镀")).toBe("B");
    expect(二次加工字母("BD", "喷油")).toBe("D");
    expect(二次加工字母("AF", "植绒")).toBe("F");
    expect(二次加工字母("AH", "植发")).toBe("H");
    expect(二次加工字母("XX", "电镀")).toBeNull();
  });
});

// ---------- 页面 ----------

const PERMS_FULL = [{ 组: "塑胶仓储", 菜单: "塑胶共用物料表", 打开: true, 保存: true, 删除: true, 单价: true }];
const PERMS_NOPRICE = [{ 组: "塑胶仓储", 菜单: "塑胶共用物料表", 打开: true, 保存: true, 删除: true }];

const LIST = {
  items: [
    {
      id: 7, 客户: "客户A", 塑胶货号: "PH-1", 工模编号: "MJ-1", 物料名称: "胶壳", 颜色: "黑",
      物料编号: "P-001", 加工内容: "喷油", 加工单价: 1.5, 套数: 4, 用量: 2, 出模数: 8, 调整审核: "1",
    },
  ],
  total: 1,
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-common-materials") return json(LIST);
      if (p.startsWith("/api/master/plastic-common-materials")) {
        if (init?.method === "POST") return json({ id: 9 });
        if (init?.method === "PUT") return json({});
        if (init?.method === "DELETE") return json({});
        return json(LIST.items[0]);
      }
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(<PlasticCommonMaterialPage />, "/plastic-common-materials");
  return calls;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticCommonMaterialPage", () => {
  it("列表渲染:客户/货号/工模/审核;价格列(有「单价」位)", async () => {
    setup();
    await screen.findByText("PH-1");
    expect(screen.getByText("客户A")).toBeInTheDocument();
    expect(screen.getByText("MJ-1")).toBeInTheDocument();
    expect(screen.getAllByText("已审核").length).toBeGreaterThan(0); // 筛选下拉 + 行内审核列
    expect(screen.getByText("加工单价")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("无「单价」位:价格列显 ***", async () => {
    setup(PERMS_NOPRICE);
    await screen.findByText("PH-1");
    expect(screen.queryByText("加工单价")).not.toBeInTheDocument();
  });

  it("查询:客户/塑胶货号/审核情况进参数", async () => {
    const calls = setup();
    await screen.findByText("PH-1");
    fireEvent.change(screen.getByLabelText("客户"), { target: { value: "客户A" } });
    fireEvent.change(screen.getByLabelText("塑胶货号"), { target: { value: "PH-1" } });
    fireEvent.click(screen.getByLabelText("审核情况"));
    fireEvent.click(screen.getByRole("option", { name: "已审核" }));
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("plastic-common-materials?") && c.url.includes(encodeURIComponent("客户A")),
      );
      expect(hit).toBeTruthy();
      const u = new URL(hit!.url, "http://test");
      expect(u.searchParams.get("塑胶货号")).toBe("PH-1");
      expect(u.searchParams.get("审核情况")).toBe("已审核");
    });
  });

  it("新增:塑胶货号必填;套数规则拦截;通过后 POST /master/plastic-common-materials", async () => {
    const calls = setup();
    await screen.findByText("PH-1");
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    const dlg0 = await screen.findByRole("dialog");
    // 塑胶货号必填(对话框内字段,与筛选栏同名 label 区分)
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请输入塑胶货号");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    // 填货号 + 套数不匹配 -> 拦截
    fireEvent.change(within(dlg0).getByLabelText("塑胶货号"), { target: { value: "PH-9" } });
    fireEvent.change(screen.getByLabelText("出模数"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("用量"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("套数"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findAllByText(套数规则提示);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    // 修正套数 -> 通过
    fireEvent.change(screen.getByLabelText("套数"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/master/plastic-common-materials"));
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.塑胶货号).toBe("PH-9");
      expect(body.套数).toBe(4);
      expect(body.出模数).toBe(8);
    });
  });

  it("双击选中 -> 编辑拉详情(GET /master) -> 删除确认 DELETE", async () => {
    const calls = setup();
    await screen.findByText("PH-1");
    fireEvent.doubleClick(screen.getByText("PH-1").closest("tr")!);
    await screen.findByText("已选中:P-001");
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/master/plastic-common-materials/7"))).toBe(true),
    );
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("编辑共用物料");
    // 关闭后删除
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await screen.findByText(/确认删除该行/);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/master/plastic-common-materials/7"))).toBe(true),
    );
    await screen.findByText("已删除");
  });

  it("无「打开」权限:整页无权提示", async () => {
    setup([]);
    await screen.findByText("无权访问该页面");
  });
});
