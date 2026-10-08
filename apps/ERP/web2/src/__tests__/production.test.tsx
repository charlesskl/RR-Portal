// 生产通知单全量对齐:逐场景对照老系统 web/src/pages/production/ProductionNoticePage.tsx
// 与 web/src/__tests__/poBinding.test.tsx 的 BOM-PO 绑定契约。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import ProductionPage from "@/pages/ProductionPage";
import type { ProductionDetail, ProductionHeader } from "@/api/types";

// 路由探针:把 location 变化回调给测试
function ProbeLoc({ onChange }: { onChange: (v: string) => void }) {
  const loc = useLocation();
  useEffect(() => {
    onChange(loc.pathname + loc.search);
  }, [loc, onChange]);
  return null;
}

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  {
    组: "工程部",
    菜单: "生产制单",
    打开: true,
    保存: true,
    删除: true,
    打印: true,
    单价: true,
    金额: true,
    审核: true,
    反审核: true,
    功能: true,
  },
];
const PERMS_NO_PRICE = [{ ...PERMS_FULL[0], 单价: false, 金额: false }];
const PERMS_NO_DELETE = [{ ...PERMS_FULL[0], 删除: false }];

const HDR_UNAUDITED: ProductionHeader = {
  id: 1,
  生产单号: "SC20260915003",
  客户款号: "K-001",
  客户编号: "C01",
  客户名称: "测试客户",
  合同号: "PO-1",
  交货日期: "2026-09-30",
  接单数量: 100,
  订单类型: "正式单",
  标识: "正单",
  制单人: "admin",
  下单日期: "2026-09-15",
  日期: "2026-09-15",
  审核: "0",
  跟单员: "小李",
  默认单价: "HK 12.5",
  工序单价: 1.5,
  物料金额: 500,
  出货单价: 20,
};
const HDR_AUDITED: ProductionHeader = { ...HDR_UNAUDITED, 审核: "1", 审核人: "经理" };
const HDR_AUDITED_REQUESTING: ProductionHeader = {
  ...HDR_AUDITED,
  反审核申请: "1",
  反审核申请人: "小王",
};

const detailOf = (h: ProductionHeader): ProductionDetail => ({
  单头: h,
  货号明细: [
    {
      货号: "92125A-S001",
      BOM款号: "92125A-S001",
      款号名称: "暹罗猫",
      数量: 100,
      比例: 1,
      分析: true,
    },
  ],
  数量: [{ 货号: "92125A-S001", 颜色: "白", 尺码: "M", 数量: 100 }],
  工序: [],
  物料: [],
});

const BOM_HEADERS = [
  {
    款号: "92125A-S001",
    款式: "暹罗猫",
    客户编号: "C01",
    客户名称: "测试客户",
    默认单价: "HK 12.5",
  },
];

interface Cfg {
  perms: unknown;
  firstList: unknown;
  list: unknown;
  detail: ProductionDetail;
  bomHeaders: unknown;
  poBindings: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    firstList: { items: [HDR_UNAUDITED], total: 1 },
    list: { items: [HDR_UNAUDITED], total: 1 },
    detail: detailOf(HDR_UNAUDITED),
    bomHeaders: BOM_HEADERS,
    poBindings: [],
  };
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
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms));
      if (p === "/api/production" && method === "GET") {
        return u.searchParams.get("size") === "1" ? json(cfg.firstList) : json(cfg.list);
      }
      if (p === "/api/production" && method === "POST")
        return json({ 生产单号: "SC20260916001" }, 201);
      if (/^\/api\/production\/[^/]+$/.test(p) && method === "GET")
        return json(cfg.detail);
      if (/^\/api\/production\/[^/]+$/.test(p) && method === "PUT") return noContent();
      if (/^\/api\/production\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      if (p.endsWith("/approve") && method === "POST") return json({});
      if (p.endsWith("/unapprove-request") && method === "POST") return json({});
      if (p === "/api/styles/bom-headers") return json(cfg.bomHeaders);
      if (/^\/api\/styles\/.+\/po-bindings$/.test(p)) return json(cfg.poBindings);
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg) => {
  const calls = installFetch(cfg);
  renderWithProviders(<ProductionPage />, "/production");
  return calls;
};

// 等待自动打开的首单详情水合到表单(未审核查看态)
const waitForm = async () =>
  waitFor(() =>
    expect(screen.getByLabelText("生产单号")).toHaveValue("SC20260915003"),
  );

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------- URL ?mo= 直开(排期页「生产下单」成功后的跳入入口,Task 10) ----------

describe("URL ?mo= 直开", () => {
  it("?mo=生产单号 进入页面直接打开该单并消费清参", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 }; // 关掉首单自动打开,防干扰
    const moDetail = detailOf({ ...HDR_UNAUDITED, 生产单号: "SC-MO-9" });
    cfg.onCall = (c) =>
      c.method === "GET" && c.url === "/api/production/SC-MO-9"
        ? json(moDetail)
        : undefined;
    const calls = installFetch(cfg);
    renderWithProviders(<ProductionPage />, "/production?mo=SC-MO-9");

    await waitFor(() =>
      expect(screen.getByLabelText("生产单号")).toHaveValue("SC-MO-9"),
    );
    expect(
      calls.some((c) => c.method === "GET" && c.url === "/api/production/SC-MO-9"),
    ).toBe(true);
  });

  // 路径门:keep-alive 隐藏页仍挂载在同一路由上,别的页(如采购物料分析?mo=)的同名参数不得消费
  it("不在 /production 路径时不认 mo 参数(不直开、不清参)", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 };
    const calls = installFetch(cfg);
    let lastLoc = "";
    renderWithProviders(
      <>
        <ProductionPage />
        <ProbeLoc onChange={(v) => (lastLoc = v)} />
      </>,
      "/purchase-material-analysis?mo=SC-MO-9",
    );
    await waitFor(() => expect(lastLoc).toContain("mo=SC-MO-9"));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.url === "/api/production/SC-MO-9")).toBe(false);
    expect(lastLoc).toContain("mo=SC-MO-9"); // 参数未被清掉
  });
});

// ---------- 新建 / 保存 ----------

describe("新建与保存", () => {
  it("点「新建」进入新建态:表单清空、标识默认正单、一行空货号", async () => {
    setup(baseCfg());
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    expect(screen.getByLabelText("生产单号")).toHaveValue("");
    expect(screen.getByLabelText("生产单号")).toBeEnabled();
    expect(screen.getByLabelText("标识")).toHaveValue("正单");
    expect(screen.getByLabelText("货号")).toHaveValue("");
    expect(screen.getByLabelText("BOM款号")).toHaveValue("");
    expect(screen.getByText("保存")).toBeInTheDocument();
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
  });

  it("保存:POST /production 载荷带 货号明细(数量明细过滤空行),成功后载入新单", async () => {
    const calls = setup(baseCfg());
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("BOM款号"), {
      target: { value: "ST-NEW" },
    });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("订单备注"), {
      target: { value: "急单" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/production"),
      ).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/production")!;
    const lines = post.body!.货号明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0].货号).toBe("ST-NEW"); // 货号留空回落 BOM款号
    expect(lines[0].BOM款号).toBe("ST-NEW");
    expect(lines[0].数量明细).toEqual([{ 数量: 50 }]);
    expect(post.body!.备注).toBe("急单");
    expect(post.body!.接单数量).toBe(50); // 留空回落明细合计

    await waitFor(() =>
      expect(screen.getByText(/生产通知单已创建:SC20260916001/)).toBeInTheDocument(),
    );
  });

  it("校验:缺 BOM款号 时保存提示错误且不发请求", async () => {
    const calls = setup(baseCfg());
    await waitForm();
    fireEvent.click(screen.getByText("新建"));
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(screen.getByText("每行货号必须填写 BOM款号")).toBeInTheDocument(),
    );
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/production"),
    ).toBe(false);
  });
});

// ---------- 打开 ----------

describe("打开", () => {
  it("打开弹窗点行载入单据(未审核进入可编辑查看态)", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 };
    setup(cfg);
    await waitFor(() =>
      expect(screen.getByText("尚未打开单据")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() =>
      expect(screen.getByText("SC20260915003")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("SC20260915003"));

    await waitForm();
    expect(screen.getByLabelText("跟单员")).toHaveValue("小李");
    expect(screen.getByText("未审核")).toBeInTheDocument();
  });
});

// ---------- 保存修改 / 删除 / 审核 ----------

describe("查看态操作", () => {
  it("保存修改:未审核单改表头,PUT 载荷 货号明细 为空数组(不动物料明细)", async () => {
    const calls = setup(baseCfg());
    await waitForm();

    fireEvent.change(screen.getByLabelText("跟单员"), { target: { value: "小张" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/production/SC20260915003",
        ),
      ).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body!.跟单员).toBe("小张");
    expect(put.body!.货号明细).toEqual([]);
    await waitFor(() => expect(screen.getByText("表头已保存")).toBeInTheDocument());
  });

  it("删除:未审核单确认后 DELETE,回到新建态", async () => {
    const calls = setup(baseCfg());
    await waitForm();

    fireEvent.click(screen.getByText("删除"));
    await waitFor(() =>
      expect(screen.getByText("确认删除该生产单?")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("确认删除"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.url === "/api/production/SC20260915003",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("生产单号")).toHaveValue(""),
    );
    expect(screen.getByText("已删除")).toBeInTheDocument();
  });

  it("审核:POST approve 后重新载入,流转到已审核", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      // 审核完成后 refetch 返回已审核详情
      if (c.url.endsWith("/approve")) cfg.detail = detailOf(HDR_AUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitForm();

    fireEvent.click(screen.getByText("审核"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" && c.url === "/api/production/SC20260915003/approve",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByText("申请反审核")).toBeInTheDocument(),
    );
    // 徽章 + 成功提示都可能带「已审核」文案
    expect(screen.getAllByText("已审核").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
  });

  it("已审核:禁删禁改(无删除/保存修改/审核按钮),只读单头卡 + 申请反审核入口", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [HDR_AUDITED], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED);
    setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());

    expect(screen.queryByText("删除")).not.toBeInTheDocument();
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.queryByText("审核")).not.toBeInTheDocument();
    expect(screen.getByText("申请反审核")).toBeInTheDocument();
    // 只读卡:展开更多字段可用
    fireEvent.click(screen.getByText("展开更多字段"));
    await waitFor(() => expect(screen.getByText("审核人")).toBeInTheDocument());
    expect(screen.getByText("经理")).toBeInTheDocument();
  });
});

// ---------- 申请反审核 ----------

describe("申请反审核", () => {
  const auditedCfg = () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [HDR_AUDITED], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED);
    return cfg;
  };

  it("必填原因:空原因提交被拦,不发请求", async () => {
    const calls = setup(auditedCfg());
    await waitFor(() => expect(screen.getByText("申请反审核")).toBeInTheDocument());

    fireEvent.click(screen.getByText("申请反审核"));
    await waitFor(() =>
      expect(screen.getByText(/申请反审核 SC20260915003/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("提交申请"));

    await waitFor(() =>
      expect(screen.getByText("请填写反审核原因")).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.url.includes("unapprove-request"))).toBe(false);
  });

  it("整步反审核(默认):POST unapprove-request 含BOM=true", async () => {
    const calls = setup(auditedCfg());
    await waitFor(() => expect(screen.getByText("申请反审核")).toBeInTheDocument());

    fireEvent.click(screen.getByText("申请反审核"));
    fireEvent.change(screen.getByPlaceholderText("请填写反审核原因(必填)"), {
      target: { value: "下错数量" },
    });
    fireEvent.click(screen.getByText("提交申请"));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("unapprove-request"))).toBe(true),
    );
    const post = calls.find((c) => c.url.includes("unapprove-request"))!;
    expect(post.method).toBe("POST");
    expect(post.url).toBe("/api/production/SC20260915003/unapprove-request");
    expect(post.body).toEqual({ 原因: "下错数量", 含BOM: true });
    await waitFor(() =>
      expect(screen.getByText("已提交反审核申请,待经理批准")).toBeInTheDocument(),
    );
  });

  it("单个反审核:选「仅生产单」后 含BOM=false", async () => {
    const calls = setup(auditedCfg());
    await waitFor(() => expect(screen.getByText("申请反审核")).toBeInTheDocument());

    fireEvent.click(screen.getByText("申请反审核"));
    fireEvent.click(screen.getByText("单个反审核(仅生产单,不动BOM)"));
    fireEvent.change(screen.getByPlaceholderText("请填写反审核原因(必填)"), {
      target: { value: "只退生产单" },
    });
    fireEvent.click(screen.getByText("提交申请"));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("unapprove-request"))).toBe(true),
    );
    expect(calls.find((c) => c.url.includes("unapprove-request"))!.body).toEqual({
      原因: "只退生产单",
      含BOM: false,
    });
  });

  it("申请中:显示待批准标记,不再显示申请按钮", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [HDR_AUDITED_REQUESTING], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED_REQUESTING);
    setup(cfg);

    await waitFor(() =>
      expect(screen.getByText(/反审核申请中\(小王\),待经理批准/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("申请反审核")).not.toBeInTheDocument();
  });
});

// ---------- 打印 ----------

describe("打印", () => {
  it("点「打印」调用 window.print", async () => {
    const printSpy = vi.fn();
    window.print = printSpy;
    setup(baseCfg());
    await waitForm();

    fireEvent.click(screen.getByText("打印"));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------- 货号明细行编辑 ----------

describe("货号明细行编辑", () => {
  it("选中已设 BOM 的货号:回填 款号名称/BOM款号/分析 + 表头客户与默认单价", async () => {
    setup(baseCfg());
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("货号"), {
      target: { value: "92125A-S001" },
    });

    expect(screen.getByLabelText("货号")).toHaveValue("92125A-S001");
    expect(screen.getByLabelText("BOM款号")).toHaveValue("92125A-S001");
    expect(screen.getByLabelText("款号名称")).toHaveValue("暹罗猫");
    expect(screen.getByLabelText("分析")).toBeChecked();
    expect(screen.getByLabelText("客户编号")).toHaveValue("C01");
    expect(screen.getByLabelText("客户名称")).toHaveValue("测试客户");
    expect(screen.getByLabelText("默认单价")).toHaveValue("HK 12.5");
    expect(screen.getByLabelText("客户款号")).toHaveValue("92125A-S001");
  });

  it("数量手输生成无色码数量行;添加色码行后可编辑颜色/尺码/数量;比例可改", async () => {
    setup(baseCfg());
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "30" } });
    // 手输数量 = 一条无色码行,出现在色码表
    await waitFor(() =>
      expect(screen.getByLabelText("色码数量")).toHaveValue(30),
    );

    fireEvent.click(screen.getByText("添加色码行"));
    const qtyInputs = screen.getAllByLabelText("色码数量");
    expect(qtyInputs).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("颜色")[1], {
      target: { value: "黑" },
    });
    fireEvent.change(qtyInputs[1], { target: { value: "20" } });
    // 数量列变回色码合计
    await waitFor(() => expect(screen.getByLabelText("数量")).toHaveValue(50));

    fireEvent.change(screen.getByLabelText("比例"), { target: { value: "1.5" } });
    expect(screen.getByLabelText("比例")).toHaveValue(1.5);
  });

  it("数量按排期实单带出:填合同号后选货号自动带出(排除已取消/不匹配);已有数量不覆盖", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      const u = new URL(c.url, "http://test");
      if (u.pathname === "/api/scheduling")
        return json({
          items: [
            { ID: 1, PO号: "PO-1", 货号: "92125A-S001", 数量: 600, 状态: "在排" },
            { ID: 2, PO号: "PO-1", 货号: "92125A-S001", 数量: 120, 状态: "已取消" }, // 已取消排除
            { ID: 3, PO号: "PO-1", 货号: "其他货号", 数量: 999, 状态: "在排" }, // 货号不匹配
            { ID: 4, PO号: "PO-2", 货号: "92125A-S001", 数量: 888, 状态: "在排" }, // PO 不匹配
          ],
          total: 4,
        });
      return undefined;
    };
    setup(cfg);
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    // 未填合同号先选货号 → 不带出
    fireEvent.change(screen.getByLabelText("货号"), { target: { value: "92125A-S001" } });
    await waitFor(() => expect(screen.getByLabelText("款号名称")).toHaveValue("暹罗猫"));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByLabelText("数量")).toHaveValue(null);

    // 填合同号后离焦 → 按排期带出 600(在排行合计,排除已取消/货号或PO不匹配)
    fireEvent.change(screen.getByLabelText("合同号"), { target: { value: "PO-1" } });
    fireEvent.blur(screen.getByLabelText("合同号"));
    await waitFor(() => expect(screen.getByLabelText("数量")).toHaveValue(600));
    // 无色码数量行同步出现(色码本来就可空)
    await waitFor(() => expect(screen.getByLabelText("色码数量")).toHaveValue(600));

    // 手改数量后再离焦:已有数量不被覆盖
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "30" } });
    fireEvent.blur(screen.getByLabelText("合同号"));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByLabelText("数量")).toHaveValue(30);
  });

  it("合同号按 BOM 绑定带出:选货号时合同号空→取绑定列表最新 PO,数量随之按排期带出", async () => {
    const cfg = baseCfg();
    cfg.poBindings = [{ PO号: "PO-9", 绑定时间: "2026-09-01" }];
    cfg.onCall = (c) => {
      const u = new URL(c.url, "http://test");
      if (u.pathname === "/api/scheduling")
        return json({
          items: [{ ID: 1, PO号: "PO-9", 货号: "92125A-S001", 数量: 924, 状态: "在排" }],
          total: 1,
        });
      return undefined;
    };
    setup(cfg);
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("货号"), { target: { value: "92125A-S001" } });
    // 合同号自动带出 BOM 绑定的 PO,数量随后按排期带出
    await waitFor(() => expect(screen.getByLabelText("合同号")).toHaveValue("PO-9"));
    await waitFor(() => expect(screen.getByLabelText("数量")).toHaveValue(924));
  });

  it("合同号按 BOM 绑定带出:BOM 未审核无绑定记录时回落 待绑定PO号", async () => {
    const cfg = baseCfg();
    cfg.poBindings = [];
    cfg.bomHeaders = [{ ...BOM_HEADERS[0], 待绑定PO号: "PO-8" }];
    setup(cfg);
    await waitForm();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("货号"), { target: { value: "92125A-S001" } });
    await waitFor(() => expect(screen.getByLabelText("合同号")).toHaveValue("PO-8"));
  });
});

// ---------- 物料清单(半成品需求) ----------

describe("物料清单", () => {
  it("实单版 BOM:半成品需求区块展示(用量分数回显,不参与采购提示)", async () => {
    const cfg = baseCfg();
    cfg.detail = {
      ...detailOf(HDR_UNAUDITED),
      半成品需求: [
        { 货号: "92125A-S001", 物料编号: "SEMI-1", 物料名称: "猫公仔大蛋", 单位: "个", 用量: 0.1667, 总数量: 154.03 },
      ],
    };
    setup(cfg);
    await waitForm();
    fireEvent.click(screen.getByRole("button", { name: "物料清单" }));
    await waitFor(() =>
      expect(screen.getByText(/半成品需求\(由半成品仓\/装配领料,不参与采购\)/)).toBeInTheDocument(),
    );
    expect(screen.getByText("SEMI-1")).toBeInTheDocument();
    expect(screen.getByText("猫公仔大蛋")).toBeInTheDocument();
    expect(screen.getByText("1/6")).toBeInTheDocument(); // 0.1667 → 分数回显
    expect(screen.getByText("154.03")).toBeInTheDocument();
  });

  it("无半成品需求:不渲染半成品需求区块", async () => {
    setup(baseCfg()); // detailOf 无 半成品需求
    await waitForm();
    fireEvent.click(screen.getByRole("button", { name: "物料清单" }));
    await waitFor(() => expect(screen.getByText("该货号没有物料")).toBeInTheDocument());
    expect(screen.queryByText(/半成品需求/)).not.toBeInTheDocument();
  });
});

// ---------- BOM-PO 绑定确认 ----------

describe("BOM-PO 绑定确认", () => {
  const poCfg = () => {
    const cfg = baseCfg();
    cfg.poBindings = [
      { PO号: "PO-OTHER", 绑定时间: "2026-09-01" },
      { PO号: "PO-OTHER2", 绑定时间: "2026-09-02" },
    ];
    return cfg;
  };

  const fillPoAndBom = async () => {
    await waitForm();
    fireEvent.click(screen.getByText("新建"));
    fireEvent.change(screen.getByLabelText("合同号"), { target: { value: "PO-1" } });
    fireEvent.change(screen.getByLabelText("BOM款号"), {
      target: { value: "92125A-S001" },
    });
  };

  it("已绑别的 PO:弹确认框列出 PO 号,点「继续使用」后采用该 BOM(与当前 PO 双绑)", async () => {
    const calls = setup(poCfg());
    await fillPoAndBom();

    await waitFor(() =>
      expect(
        screen.getByText(/款号 92125A-S001 的 BOM 已绑定其他 PO/),
      ).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.url === "/api/styles/92125A-S001/po-bindings")).toBe(
      true,
    );
    expect(screen.getByText("PO-OTHER")).toBeInTheDocument();
    expect(screen.getByText("PO-OTHER2")).toBeInTheDocument();
    expect(
      screen.getByText("已绑定 PO：PO-OTHER、PO-OTHER2，是否继续使用？"),
    ).toBeInTheDocument();
    // 未确认前不采用
    expect(screen.getByLabelText("BOM款号")).toHaveValue("");

    fireEvent.click(screen.getByText("继续使用"));
    await waitFor(() =>
      expect(screen.getByLabelText("BOM款号")).toHaveValue("92125A-S001"),
    );
  });

  it("点「取消」不采用该 BOM", async () => {
    setup(poCfg());
    await fillPoAndBom();
    await waitFor(() => expect(screen.getByText("取消")).toBeInTheDocument());

    fireEvent.click(screen.getByText("取消"));
    await waitFor(() =>
      expect(
        screen.queryByText(/款号 92125A-S001 的 BOM 已绑定其他 PO/),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("BOM款号")).toHaveValue("");
  });

  it("仅绑定当前 PO:不弹框直接采用", async () => {
    const cfg = baseCfg();
    cfg.poBindings = [{ PO号: "PO-1", 绑定时间: "2026-09-01" }];
    setup(cfg);
    await fillPoAndBom();

    await waitFor(() =>
      expect(screen.getByLabelText("BOM款号")).toHaveValue("92125A-S001"),
    );
    expect(
      screen.queryByText(/的 BOM 已绑定其他 PO/),
    ).not.toBeInTheDocument();
  });

  it("无绑定(空数组):不弹框直接采用", async () => {
    const calls = setup(baseCfg()); // baseCfg.poBindings 默认为 []
    await fillPoAndBom();

    await waitFor(() =>
      expect(screen.getByLabelText("BOM款号")).toHaveValue("92125A-S001"),
    );
    expect(calls.some((c) => c.url.includes("po-bindings"))).toBe(true);
    expect(
      screen.queryByText(/的 BOM 已绑定其他 PO/),
    ).not.toBeInTheDocument();
  });

  it("po-bindings 查询失败:不阻塞流程,不弹框直接放行", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) =>
      c.url.includes("po-bindings") ? json({ 消息: "boom" }, 500) : undefined;
    setup(cfg);
    await fillPoAndBom();

    await waitFor(() =>
      expect(screen.getByLabelText("BOM款号")).toHaveValue("92125A-S001"),
    );
    expect(
      screen.queryByText(/的 BOM 已绑定其他 PO/),
    ).not.toBeInTheDocument();
  });

  it("合同号为空:不查询绑定,直接采用", async () => {
    const calls = setup(poCfg());
    await waitForm();
    fireEvent.click(screen.getByText("新建"));
    fireEvent.change(screen.getByLabelText("BOM款号"), {
      target: { value: "92125A-S001" },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("BOM款号")).toHaveValue("92125A-S001"),
    );
    expect(calls.some((c) => c.url.includes("po-bindings"))).toBe(false);
  });
});

// ---------- 权限脱敏 ----------

describe("权限脱敏", () => {
  it("无「单价/金额」位:已审核单头卡价格字段全部脱敏为 ***", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_PRICE;
    cfg.firstList = { items: [HDR_AUDITED], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED);
    setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());

    expect(screen.queryByText("HK 12.5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("展开更多字段"));
    await waitFor(() => expect(screen.getByText("物料金额")).toBeInTheDocument());
    const stars = screen.getAllByText("***");
    // 默认单价 + 工序单价 + 物料金额 + 出货单价
    expect(stars.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("500")).not.toBeInTheDocument();
  });

  it("有「单价」位:价格字段正常显示", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [HDR_AUDITED], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED);
    setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());

    expect(screen.getByText("HK 12.5")).toBeInTheDocument();
    fireEvent.click(screen.getByText("展开更多字段"));
    await waitFor(() => expect(screen.getByText("500")).toBeInTheDocument());
    expect(screen.queryByText("***")).not.toBeInTheDocument();
  });

  it("无「删除」位:未审核单也不渲染删除按钮", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_DELETE;
    setup(cfg);
    await waitForm();

    await waitFor(() =>
      expect(screen.queryByText("删除")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("保存修改")).toBeInTheDocument();
  });
});
