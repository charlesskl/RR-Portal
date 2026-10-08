// 消息中心页全量对齐:行为照抄老系统 web/src/pages/MessagesPage.tsx
//  - 列表分页/只看未读/全部、标记已读(与铃铛弹层同一 messagesApi 数据源)
//  - 审批类消息(反审核审批/BOM反审核审批):审批弹窗,「同意反审核/拒绝」
//    (端点/载荷照抄老系统 web/src/api/production.ts + styles.ts,无 body);
//    无前端权限门(终审裁决,对齐老系统):按钮只看消息类型,后端 IsManagerAsync 兜底
//  - 结果类/其他消息点击跳对应单据页:反审核结果 -> /production?mo=;领料审批 -> /material-issues?doc=;
//    补料审批 -> /replenishments?doc=(Batch 3 已注册)
//  - 目标页未注册按 MENU_PATHS 裁决:toast 记下参数,不静默断链
//  - 铃铛弹层底部「查看全部」跳 /messages
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MessagesPage from "@/pages/MessagesPage";
import { MessageBell } from "@/layout/MessageBell";
import type { MessageRow } from "@/api/types";

// ---------- 测试基建:fetch 路由桩(同 production.test.tsx 模式) ----------

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

// 经理权限:生产制单·审核 位(三级流转经理审核同一位)
const PERMS_MANAGER = [
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
const PERMS_NO_AUDIT = [{ ...PERMS_MANAGER[0], 审核: false }];

// 行 1 故意用 camelCase id:验证 messagesApi.list 归一化为 ID(标记已读要用)
const ROWS: MessageRow[] = [
  {
    id: 7,
    类型: "反审核审批",
    单号: "SC20260916001",
    标题: "生产单反审核申请",
    内容: "小王申请反审核生产单 SC20260916001,原因:客户改单",
    已读: "0",
    创建时间: "2026-09-16T10:00:00",
  },
  {
    ID: 8,
    类型: "领料审批",
    单号: "LL20260916002",
    标题: "新的领料单待主管审核",
    内容: "来料领料单 LL20260916002 已提交",
    已读: "1",
    创建时间: "2026-09-16T09:30:00",
  },
  {
    ID: 9,
    类型: "BOM反审核审批",
    单号: "92125A-S001",
    标题: "工程BOM反审核申请",
    内容: "小李申请款号 92125A-S001 BOM 反审核",
    已读: "1",
    创建时间: "2026-09-16T09:00:00",
  },
  {
    ID: 10,
    类型: "补料审批",
    单号: "BUL20260916003",
    标题: "补料单待审核",
    内容: "补料单 BUL20260916003 已提交",
    已读: "1",
    创建时间: "2026-09-16T08:00:00",
  },
  {
    ID: 11,
    类型: "BOM反审核结果",
    单号: "92125A-S001",
    标题: "BOM反审核已批准",
    内容: "你申请的款号 92125A-S001 工程BOM反审核已由 经理 批准",
    已读: "1",
    创建时间: "2026-09-16T07:30:00",
  },
];

interface Cfg {
  rows: MessageRow[];
  total: number;
  unread: number;
  perms: unknown;
  // 设置后审批端点(approve/reject)以 403 + 该文案失败,模拟后端 IsManagerAsync 兜底拒绝
  decideFail?: string;
}

const baseCfg = (): Cfg => ({ rows: ROWS, total: 25, unread: 3, perms: PERMS_MANAGER });

function installFetch(cfg: Cfg) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms));
      if (p === "/api/messages" && method === "GET")
        return json({ items: cfg.rows, total: cfg.total });
      if (p === "/api/messages/unread-count") return json({ count: cfg.unread });
      if (/^\/api\/messages\/\d+\/read$/.test(p) && method === "POST") return noContent();
      // 反审核申请审批(生产单/工程BOM;照抄老系统端点,无载荷)
      if (/\/unapprove-request\/(approve|reject)$/.test(p) && method === "POST")
        return cfg.decideFail ? json({ 消息: cfg.decideFail }, 403) : noContent();
      if (/\/bom-reverse-audit-request\/(approve|reject)$/.test(p) && method === "POST")
        return cfg.decideFail ? json({ 消息: cfg.decideFail }, 403) : noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

// 路由探针:记录当前 location(验证点击消息后的跳转);effect 里赋值,避免渲染期副作用
let lastLoc = "";
function Probe() {
  const l = useLocation();
  useEffect(() => {
    lastLoc = l.pathname + l.search;
  }, [l]);
  return null;
}

const msgCalls = (calls: Call[]) =>
  calls.filter((c) => new URL(c.url, "http://test").pathname === "/api/messages");
const listParam = (c: Call, k: string) =>
  new URL(c.url, "http://test").searchParams.get(k);

const renderPage = (cfg: Cfg) => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <>
      <Probe />
      <MessagesPage />
    </>,
    "/messages",
  );
  return calls;
};

const waitList = () =>
  waitFor(() => expect(screen.getByText("生产单反审核申请")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "manager1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------- 列表加载 / 分页 / 筛选 ----------

describe("列表与筛选", () => {
  it("加载列表:GET /messages 带 onlyUnread=false&page=1&size=20,渲染行与未读徽标", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    const first = msgCalls(calls)[0];
    expect(listParam(first, "onlyUnread")).toBe("false");
    expect(listParam(first, "page")).toBe("1");
    expect(listParam(first, "size")).toBe("20");
    // 行全渲染;未读行带 未读 标记
    expect(screen.getByText("新的领料单待主管审核")).toBeInTheDocument();
    expect(screen.getByText("工程BOM反审核申请")).toBeInTheDocument();
    expect(screen.getByText("补料单待审核")).toBeInTheDocument();
    expect(screen.getByText("未读")).toBeInTheDocument();
    expect(screen.getByText("共 25 条")).toBeInTheDocument();
    // 未读数与铃铛同源(queryKey messages-unread-count)
    expect(
      calls.some((c) => c.url.includes("/api/messages/unread-count")),
    ).toBe(true);
  });

  it("只看未读:切换后回第 1 页并按 onlyUnread=true 重拉", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getByText("只看未读"));

    await waitFor(() =>
      expect(
        msgCalls(calls).some(
          (c) => listParam(c, "onlyUnread") === "true" && listParam(c, "page") === "1",
        ),
      ).toBe(true),
    );
  });

  it("分页:下一页带 page=2;切每页 50 条回第 1 页", async () => {
    const calls = renderPage(baseCfg());
    await waitList();
    expect(screen.getByText("第 1 / 2 页")).toBeInTheDocument();

    fireEvent.click(screen.getByText("下一页"));
    await waitFor(() =>
      expect(msgCalls(calls).some((c) => listParam(c, "page") === "2")).toBe(true),
    );

    fireEvent.click(screen.getByLabelText("每页条数"));
    fireEvent.click(screen.getByRole("option", { name: "50 条/页" }));
    await waitFor(() =>
      expect(
        msgCalls(calls).some(
          (c) => listParam(c, "size") === "50" && listParam(c, "page") === "1",
        ),
      ).toBe(true),
    );
  });
});

// ---------- 查看:标记已读 + 按类型分流跳单据页 ----------

describe("消息查看分流", () => {
  it("反审核审批(未读,camelCase id 归一化):先 POST /messages/7/read,开审批弹窗;「查看单据」跳 /production?mo=", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[0]);

    // 标记已读 + 审批弹窗打开
    await waitFor(() =>
      expect(screen.getByText("同意反审核")).toBeInTheDocument(),
    );
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/messages/7/read"),
    ).toBe(true);
    // 标记已读后重拉列表与未读数(铃铛同源)
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url.includes("/api/messages/unread-count")).length,
      ).toBeGreaterThan(1),
    );

    fireEvent.click(screen.getByText("查看单据"));
    await waitFor(() => expect(lastLoc).toBe("/production?mo=SC20260916001"));
  });

  it("领料审批(已读):不重复标记已读,跳 /material-issues?doc= 直开该领料单", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[1]);

    await waitFor(() =>
      expect(lastLoc).toBe("/material-issues?doc=LL20260916002"),
    );
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/messages/8/read"),
    ).toBe(false);
  });

  it("BOM反审核结果:跳 /bom-setup 打开该货号(Batch 1 已注册)", async () => {
    renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[4]);

    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=92125A-S001"));
  });

  it("补料审批(BUL 前缀):直跳补料单页并带 doc 参数(/replenishments 已注册)", async () => {
    renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[3]);

    await waitFor(() =>
      expect(lastLoc).toBe("/replenishments?" + "doc=BUL20260916003"),
    );
  });
});

// ---------- 反审核审批弹窗(经理同意/拒绝;老系统抽屉行为) ----------

describe("反审核审批弹窗", () => {
  it("同意反审核:POST /production/{单号}/unapprove-request/approve(无载荷),成功文案照抄老系统,关窗重拉", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[0]);
    await waitFor(() => expect(screen.getByText("同意反审核")).toBeInTheDocument());

    fireEvent.click(screen.getByText("同意反审核"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/production/SC20260916001/unapprove-request/approve",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("已同意反审核,已回到未审核")).toBeInTheDocument();
    // 关窗 + 重拉列表
    await waitFor(() =>
      expect(screen.queryByText("同意反审核")).not.toBeInTheDocument(),
    );
    expect(msgCalls(calls).length).toBeGreaterThan(1);
  });

  it("拒绝:POST /production/{单号}/unapprove-request/reject,文案照抄老系统", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[0]);
    await waitFor(() => expect(screen.getByText("同意反审核")).toBeInTheDocument());

    fireEvent.click(screen.getByText("拒绝"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/production/SC20260916001/unapprove-request/reject",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("已拒绝该反审核申请")).toBeInTheDocument();
  });

  it("BOM反审核审批:单号位=款号,同意走 styles 端点;弹窗不提供单据跳转(目标页未注册)", async () => {
    const calls = renderPage(baseCfg());
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[2]);
    await waitFor(() => expect(screen.getByText("同意反审核")).toBeInTheDocument());
    // 款号标签 + 无「查看单据」
    expect(screen.getByText("款号")).toBeInTheDocument();
    expect(screen.queryByText("查看单据")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("同意反审核"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/styles/92125A-S001/bom-reverse-audit-request/approve",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("已同意反审核,已回到未审核")).toBeInTheDocument();
  });

  it("无审核位的经理(终审裁决,对齐老系统):按钮照渲染;后端拒绝时 toast 报错文案", async () => {
    localStorage.setItem("web2.user", "op1");
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_AUDIT;
    cfg.decideFail = "仅经理可审批反审核申请";
    const calls = renderPage(cfg);
    await waitList();

    fireEvent.click(screen.getAllByText("查看")[0]);

    // 无前端权限门:无「生产制单·审核」位也渲染同意/拒绝按钮
    await waitFor(() => expect(screen.getByText("同意反审核")).toBeInTheDocument());
    expect(screen.getByText("拒绝")).toBeInTheDocument();

    // 后端 IsManagerAsync 兜底拒绝:toast 展示后端错误文案,弹窗保留可重试
    fireEvent.click(screen.getByText("同意反审核"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/production/SC20260916001/unapprove-request/approve",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("仅经理可审批反审核申请")).toBeInTheDocument();
    expect(screen.getByText("同意反审核")).toBeInTheDocument();
  });
});

// ---------- 铃铛弹层 ----------

describe("顶栏铃铛弹层", () => {
  it("底部「查看全部」跳消息中心页 /messages", async () => {
    installFetch(baseCfg());
    renderWithProviders(
      <>
        <Probe />
        <MessageBell />
      </>,
      "/",
    );

    fireEvent.click(screen.getByTitle("消息"));
    await waitFor(() =>
      expect(screen.getByText("生产单反审核申请")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("查看全部"));
    expect(lastLoc).toBe("/messages");
  });
});
