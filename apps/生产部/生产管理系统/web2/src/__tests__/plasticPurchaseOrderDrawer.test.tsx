// 塑胶采购订单新建抽屉·二次加工:行来自「可二次加工库存」(行级没有 加工内容,带的是 已加工工序)。
// 回归:保存时 filterSubmitLines 曾按喷油单+单头加工内容逐行裁剪,65 行全部被剔 ->
// 误报「请至少录入一行数量>0的明细」。修复后二次加工不做行级裁剪,单头选的工序落到每行明细。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticPurchaseOrderDrawer from "@/pages/PlasticPurchaseOrderDrawer";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "塑胶采购", 菜单: "塑胶采购订单", 打开: true, 保存: true }];

// 可加工库存行:无 加工内容 字段(对照 SecondProcessStockRow);需求加工内容=物料资料/BOM(选印喷只显示需要印喷的件)
const STOCK = [
  { 物料编号: "57001539", 物料名称: "手链蛋菱形件", 颜色: "珠光白", 单位: "个", 已加工工序: "啤塑", 需求加工内容: "印喷", 来源采购单号: "SP1", 生产单号: "SC1", 款号: "92125-MA", 可用库存: 100 },
  { 物料编号: "57001621", 物料名称: "紫猫公仔", 颜色: "半透珠光935C", 单位: "个", 已加工工序: "啤塑", 需求加工内容: "印喷", 来源采购单号: "SP1", 生产单号: "SC1", 款号: "92125-MA", 可用库存: 50 },
];

// 混合需求:印喷/电镀/无需求 各一
const STOCK_MIXED = [
  { 物料编号: "M-YP", 物料名称: "需印喷件", 颜色: "白", 单位: "个", 需求加工内容: "印喷", 来源采购单号: "SP1", 生产单号: "SC1", 款号: "K1", 可用库存: 10 },
  { 物料编号: "M-DD", 物料名称: "需电镀件", 颜色: "黑", 单位: "个", 需求加工内容: "电镀", 来源采购单号: "SP1", 生产单号: "SC1", 款号: "K1", 可用库存: 20 },
  { 物料编号: "M-NO", 物料名称: "无需求件", 颜色: "红", 单位: "个", 来源采购单号: "SP1", 生产单号: "SC1", 款号: "K1", 可用库存: 30 },
];

// 按生产单带料 basis 行:M1 需印喷(库存0默认勾),M2 无加工需求(库存够默认不勾)
const BASIS = [
  { 生产单号: "SC1", 合同号: "PO-1", 物料编号: "M1", 物料名称: "壳", 颜色: "白", 单位: "个", 计划数量: 100, 用量: 1, 加工内容: "印喷", 已订数量: 0, 可用库存: 0 },
  { 生产单号: "SC1", 合同号: "PO-1", 物料编号: "M2", 物料名称: "盖", 颜色: "黑", 单位: "个", 计划数量: 100, 用量: 1, 已订数量: 0, 可用库存: 500 },
];

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL, stock: unknown[] = STOCK, basis: unknown[] = BASIS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-purchase-orders/second-process-stock") return json(stock);
      if (p === "/api/plastic-purchase-orders/basis") return json(basis);
      if (p === "/api/plastic-purchase-orders/processing-contents") return json(["印喷", "电镀"]);
      if (p === "/api/master/suppliers")
        return json({
          items: [
            { 供应商编号: "129", 供应商名称: "兴信喷油车间" },
            { 供应商编号: "130", 供应商名称: "兴信A车间" },
          ],
          total: 2,
        });
      if (p === "/api/plastic-purchase-orders" && init?.method === "POST") return json({ 单号: "SP-NEW" });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown, drawerProps?: Record<string, unknown>, stock?: unknown[], basis?: unknown[]) => {
  const calls = installFetch(perms ?? PERMS_FULL, stock ?? STOCK, basis ?? BASIS);
  renderWithProviders(
    <PlasticPurchaseOrderDrawer open initial加工类型="二次加工" onClose={() => {}} {...drawerProps} />,
    "/plastic-purchase-orders",
  );
  return calls;
};

// SearchSelect:点开按钮再点选项
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticPurchaseOrderDrawer·二次加工", () => {
  it("加载可二次加工库存:全部默认勾选,数量默认=可用库存", async () => {
    setup();
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("塑胶采购订单(新建) · 二次加工");
    await screen.findByText("手链蛋菱形件");
    expect(screen.getByText("紫猫公仔")).toBeInTheDocument();
    // 默认全部勾选,订购数量=可用库存
    expect(screen.getByLabelText("选择 57001539")).toBeChecked();
    expect(screen.getByLabelText("选择 57001621")).toBeChecked();
    expect(screen.getByLabelText("订购数量 57001539")).toHaveValue(100);
    expect(screen.getByLabelText("订购数量 57001621")).toHaveValue(50);
  });

  it("喷油供应商+印喷保存:不做行级裁剪,单头工序落到每行明细", async () => {
    const calls = setup();
    await screen.findByText("手链蛋菱形件");
    // 选喷油供应商
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信喷油车间"));
    // 喷油单加工内容必填:选印喷
    pickOption("加工内容", "印喷");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    // 不再误报「请至少录入一行数量>0的明细」
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST"),
      ).toBe(true),
    );
    expect(screen.queryByText("请至少录入一行数量>0的明细")).not.toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.加工类型).toBe("二次加工");
    expect(body.加工内容).toBe("印喷");
    expect(body.库存加工).toBe(true); // 按库存选料的加工单,后端校验 订购≤实时库存
    expect(body.明细).toHaveLength(2);
    expect(body.明细.map((l: { 物料编号: string }) => l.物料编号)).toEqual(["57001539", "57001621"]);
    // 单头选的工序落到每行明细
    for (const l of body.明细) {
      expect(l.加工内容).toBe("印喷");
    }
    expect(body.明细[0].数量).toBe(100);
    expect(body.明细[1].数量).toBe(50);
  });

  it("二次加工数量超过可用库存:拦截并提示", async () => {
    const calls = setup();
    await screen.findByText("手链蛋菱形件");
    fireEvent.change(screen.getByLabelText("订购数量 57001539"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信喷油车间"));
    pickOption("加工内容", "印喷");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/二次加工数量超过可用库存/);
    expect(calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")).toBe(false);
  });
});

describe("PlasticPurchaseOrderDrawer·库存加工·一次加工", () => {
  it("库存加工+一次加工:按阶段=一次加工取啤机单入仓产出,保存载荷带 库存加工", async () => {
    const calls = setup(undefined, { initial加工类型: "一次加工", 库存加工: true });
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("塑胶采购订单(新建) · 一次加工");
    await screen.findByText("手链蛋菱形件");
    // 取数走 阶段=一次加工(啤机单入仓产出)
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("second-process-stock") && decodeURIComponent(c.url).includes("阶段=一次加工"),
        ),
      ).toBe(true),
    );
    // 按库存列:一次加工显示 需求加工内容/来源采购单,不出现模具编号列
    expect(dlg).toHaveTextContent("需求加工内容");
    expect(dlg).toHaveTextContent("来源采购单");
    expect(screen.queryByText("模具编号")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信喷油车间"));
    pickOption("加工内容", "印喷");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST"),
      ).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.加工类型).toBe("一次加工");
    expect(body.加工内容).toBe("印喷");
    expect(body.库存加工).toBe(true);
    expect(body.明细).toHaveLength(2);
    for (const l of body.明细) expect(l.加工内容).toBe("印喷");
  });

  it("库存加工不选加工内容:拦截(未选加工内容不算一次/二次加工)", async () => {
    const calls = setup(undefined, { initial加工类型: "一次加工", 库存加工: true });
    await screen.findByText("手链蛋菱形件");
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信A车间")); // 非喷油供应商,命中按库存必填门
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/按库存加工下单必须选择加工内容/);
    expect(calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")).toBe(false);
  });

  it("库存加工切到二次加工:重新按阶段=二次加工取数", async () => {
    const calls = setup(undefined, { initial加工类型: "一次加工", 库存加工: true });
    await screen.findByText("手链蛋菱形件");
    fireEvent.click(screen.getByRole("button", { name: "二次加工" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("second-process-stock") && decodeURIComponent(c.url).includes("阶段=二次加工"),
        ),
      ).toBe(true),
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent("塑胶采购订单(新建) · 二次加工");
  });

  it("没有库存时输生产单号带料:行来自 BOM,保存不走库存门(没有库存也能下单)", async () => {
    const calls = setup(undefined, { initial加工类型: "一次加工", 库存加工: true }, []);
    // 初始:按库存取数(空)并给出按单带料引导
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("second-process-stock"))).toBe(true),
    );
    await screen.findByText(/没有可一次加工的库存/);
    // 输入生产单号点「带料」→ 按 BOM 带料
    fireEvent.change(screen.getByLabelText("生产单号"), { target: { value: "SC1" } });
    fireEvent.click(screen.getByRole("button", { name: "带料" }));
    await screen.findByText("壳");
    expect(screen.getByText("盖")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("塑胶采购订单(新建) · SC1");
    // 选供应商+保存:载荷不带 库存加工
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信A车间"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST"),
      ).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.库存加工).toBeUndefined();
    expect(body.明细).toHaveLength(1);
    expect(body.明细[0].生产单号).toBe("SC1");
    expect(body.明细[0].物料编号).toBe("M1");
  });

  it("一次加工选「印喷」:只显示并勾选需要印喷的库存件;清空恢复全部", async () => {
    setup(undefined, { initial加工类型: "一次加工", 库存加工: true }, STOCK_MIXED);
    const dlg = await screen.findByRole("dialog");
    await screen.findByText("需印喷件");
    // 初始:三行全显示全勾选
    expect(screen.getByText("需电镀件")).toBeInTheDocument();
    expect(screen.getByText("无需求件")).toBeInTheDocument();
    expect(screen.getByLabelText("选择 M-DD")).toBeChecked();

    pickOption("加工内容", "印喷");
    // 只显示需要印喷的件,且自动勾选
    await waitFor(() => expect(screen.queryByText("需电镀件")).not.toBeInTheDocument());
    expect(screen.queryByText("无需求件")).not.toBeInTheDocument();
    expect(screen.getByText("需印喷件")).toBeInTheDocument();
    expect(screen.getByLabelText("选择 M-YP")).toBeChecked();
    expect(dlg).toHaveTextContent("加工内容「印喷」:只显示需要该工序的物料");

    // 清空加工内容:恢复全部
    pickOption("加工内容", "请选择");
    await waitFor(() => expect(screen.getByText("需电镀件")).toBeInTheDocument());
    expect(screen.getByText("无需求件")).toBeInTheDocument();
  });
});

describe("PlasticPurchaseOrderDrawer·按生产单带料(啤机/喷油同时下)", () => {
  it("mo带料也显示加工类型切换;切二次加工只换标签行不动(不看库存)", async () => {
    const calls = setup(undefined, { 生产单号: "SC1", initial加工类型: undefined });
    await screen.findByText("壳");
    // 加工类型切换常显
    expect(screen.getByRole("button", { name: "一次加工" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "二次加工" })).toBeInTheDocument();
    expect(screen.getByText(/与啤机单同时下,不用等入仓/)).toBeInTheDocument();
    // 切二次加工:行不动、不请求可加工库存
    fireEvent.click(screen.getByRole("button", { name: "二次加工" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent("塑胶采购订单(新建) · SC1 · 二次加工"),
    );
    expect(screen.getByText("壳")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("second-process-stock"))).toBe(false);

    // 二次加工标签保存:不走库存门(库存加工 不上送)
    pickOption("加工内容", "印喷");
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信A车间"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST"),
      ).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.加工类型).toBe("二次加工");
    expect(body.加工内容).toBe("印喷");
    expect(body.库存加工).toBeUndefined();
    expect(body.明细).toHaveLength(1);
    expect(body.明细[0].物料编号).toBe("M1");
  });

  it("选加工内容=下该工序加工单:行裁剪到该工序,保存 一次加工+加工内容,不走库存门", async () => {
    const calls = setup(undefined, { 生产单号: "SC1", initial加工类型: undefined });
    await screen.findByText("壳");
    expect(calls.some((c) => c.url.includes("second-process-stock"))).toBe(false);
    pickOption("加工内容", "印喷");
    // 只剩需印喷的行
    await waitFor(() => expect(screen.queryByText("盖")).not.toBeInTheDocument());
    expect(screen.getByText("壳")).toBeInTheDocument();
    // 选供应商(非喷油,验证与供应商类型无关)+保存
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信A车间"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST"),
      ).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.加工类型).toBe("一次加工");
    expect(body.加工内容).toBe("印喷");
    expect(body.库存加工).toBeUndefined(); // 不走 需先入仓/订购≤库存 的库存门
    expect(body.明细).toHaveLength(1);
    expect(body.明细[0].物料编号).toBe("M1");
    expect(body.明细[0].生产单号).toBe("SC1");
  });

  // 阶段已订:啤机阶段已订不计入印喷单;同工序已订才判重复
  const BASIS_STAGED = (
    已订啤机: number,
    已订同工序: number,
    已订总 = 已订啤机 + 已订同工序,
  ) => [
    { 生产单号: "SC1", 合同号: "PO-1", 物料编号: "M1", 物料名称: "壳", 颜色: "白", 单位: "个", 计划数量: 100, 用量: 1, 加工内容: "印喷", 已订数量: 已订总, 已订啤机数量: 已订啤机, 已订同工序数量: 已订同工序, 可用库存: 0 },
  ];

  it("印喷单不按啤机已订判重复:选印喷后已订按同工序重算,保存不再弹重复确认", async () => {
    const calls = setup(undefined, { 生产单号: "SC1", initial加工类型: undefined }, undefined, BASIS_STAGED(100, 0));
    await screen.findByText("壳");
    // 啤机阶段:已订 100 → 默认不勾 + 已下单徽标
    expect(screen.getByLabelText("选择 M1")).not.toBeChecked();
    expect(screen.getByText(/已下单 100/)).toBeInTheDocument();
    // 选印喷:同工序已订=0 → 自动勾选、徽标消失
    pickOption("加工内容", "印喷");
    await waitFor(() => expect(screen.getByLabelText("选择 M1")).toBeChecked());
    expect(screen.queryByText(/已下单/)).not.toBeInTheDocument();
    // 保存:不弹重复确认,直接 POST
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信喷油车间"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST"),
      ).toBe(true),
    );
    expect(screen.queryByText("勾选项中包含已下单物料")).not.toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.明细).toHaveLength(1);
    expect(body.明细[0].物料编号).toBe("M1");
  });

  it("同工序已订仍判重复:选印喷后已订>0 不勾,强勾保存弹重复确认", async () => {
    setup(undefined, { 生产单号: "SC1", initial加工类型: undefined }, undefined, BASIS_STAGED(0, 100));
    await screen.findByText("壳");
    // 啤机阶段:已订啤机=0 → 默认勾选(啤机没订过)
    expect(screen.getByLabelText("选择 M1")).toBeChecked();
    // 选印喷:同工序已订 100 → 自动不勾 + 徽标回来
    pickOption("加工内容", "印喷");
    await waitFor(() => expect(screen.getByLabelText("选择 M1")).not.toBeChecked());
    expect(screen.getByText(/已下单 100/)).toBeInTheDocument();
    // 手动强勾再保存 → 弹重复确认
    fireEvent.click(screen.getByLabelText("选择 M1"));
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(await screen.findByText("兴信喷油车间"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("勾选项中包含已下单物料");
  });
});
