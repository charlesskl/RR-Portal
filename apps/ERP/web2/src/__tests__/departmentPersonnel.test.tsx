// 部门人事页:对照老系统 web/src/pages/system/DepartmentPersonnelPage.tsx。
// 左侧部门(全部部门(N) + 部门(人数))/单击过滤/双击编辑(编号锁定)/删除前人数警告仍允许删;
// 右侧人员一次拉全量(2000),部门过滤+关键字(编号/姓名/职称)前端过滤,部门名称前端 join;
// 新增默认 在职 + 当前部门;编辑 GET 详情预填;日期 YYYY-MM-DD;基本工资受「人事档案·单价」位控制;
// 无「人事档案·打开」显示无权面板。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import DepartmentPersonnelPage from "@/pages/DepartmentPersonnelPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const DEPTS = [
  { id: 1, 编号: "D01", 部门: "装配部", 备注: "" },
  { id: 2, 编号: "D02", 部门: "包装部", 备注: "" },
];

const EMPS = [
  { id: 11, ID: 11, 编号: "E001", 姓名: "张三", 部门编号: "D01", 性别: "男", 职称: "组长", 手机: "13700000001", 出生日期: "1990-01-02T00:00:00", 入职日期: "2020-03-04T00:00:00", 基本工资: 5000, 在职: "在职" },
  { id: 12, ID: 12, 编号: "E002", 姓名: "李四", 部门编号: "D02", 性别: "女", 职称: "文员", 手机: "13700000002", 基本工资: 4000, 在职: "离职" },
];

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "人事档案", 打开: true, 保存: true, 删除: true, 单价: true },
  { 组: "基础资料", 菜单: "部门信息", 打开: true, 保存: true, 删除: true },
];
const PERMS_NOPRICE = [
  { 组: "基础资料", 菜单: "人事档案", 打开: true, 保存: true, 删除: true, 单价: false },
  { 组: "基础资料", 菜单: "部门信息", 打开: true, 保存: true, 删除: true },
];

type Call = { url: string; method: string; body?: Record<string, unknown> };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/master/departments" && method === "GET") return json({ items: DEPTS, total: 2 });
      if (p === "/api/master/departments" && method === "POST") return json({ id: 3 });
      if (p === "/api/master/departments/1" && method === "GET") return json(DEPTS[0]);
      if (/^\/api\/master\/departments\/\d+$/.test(p) && method === "PUT") return json({});
      if (/^\/api\/master\/departments\/\d+$/.test(p) && method === "DELETE") return noContent();
      if (p === "/api/master/employees" && method === "GET") return json({ items: EMPS, total: 2 });
      if (p === "/api/master/employees" && method === "POST") return json({ id: 13 });
      if (p === "/api/master/employees/11" && method === "GET") return json(EMPS[0]);
      if (/^\/api\/master\/employees\/\d+$/.test(p) && method === "PUT") return json({});
      if (/^\/api\/master\/employees\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms);
  renderWithProviders(<DepartmentPersonnelPage />, "/hr/department-personnel");
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DepartmentPersonnelPage", () => {
  it("左树部门计数 + 人员全量拉取(size=2000) + 部门名称前端 join", async () => {
    const calls = setup();
    await waitList();
    expect(screen.getByText("全部部门(2)")).toBeInTheDocument();
    expect(screen.getByText("装配部(1)")).toBeInTheDocument();
    expect(screen.getByText("包装部(1)")).toBeInTheDocument();
    // 部门名称列由 部门编号 join 得出
    const row = screen.getByText("张三").closest("tr")!;
    expect(within(row).getByText("装配部")).toBeInTheDocument();
    // 日期列取前 10 位
    expect(within(row).getByText("1990-01-02")).toBeInTheDocument();
    const emp = calls.find((c) => c.url.includes("/master/employees?"));
    expect(emp!.url).toContain("size=2000");
  });

  it("单击部门过滤 + 关键字前端过滤", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getByText("包装部(1)"));
    await waitFor(() => expect(screen.queryByText("张三")).not.toBeInTheDocument());
    expect(screen.getByText("李四")).toBeInTheDocument();
    fireEvent.click(screen.getByText("全部部门(2)"));
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("搜索人员"), { target: { value: "组长" } });
    await waitFor(() => expect(screen.queryByText("李四")).not.toBeInTheDocument());
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("新增人员:默认 在职 + 当前部门;编号/姓名必填;日期字段空串落 null;POST", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("装配部(1)"));
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    await waitFor(() => expect(screen.getByLabelText("编号")).toBeInTheDocument());
    expect(screen.getByLabelText("在职")).toHaveTextContent("在职");
    expect(screen.getByLabelText("部门编号")).toHaveTextContent("D01 装配部");
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByText("请输入编号")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("编号"), { target: { value: "E003" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByText("请输入姓名")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "王五" } });
    fireEvent.change(screen.getByLabelText("入职日期"), { target: { value: "2026-09-18" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/master/employees"));
      expect(post).toBeTruthy();
      expect(post!.body).toMatchObject({
        编号: "E003",
        姓名: "王五",
        在职: "在职",
        部门编号: "D01",
        入职日期: "2026-09-18",
        出生日期: null,
        离职日期: null,
      });
    });
  });

  it("编辑人员:GET 详情预填(日期截 10 位),PUT 更新", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("张三"));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));
    expect(screen.getByLabelText("出生日期")).toHaveValue("1990-01-02");
    fireEvent.change(screen.getByLabelText("职称"), { target: { value: "主管" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/master/employees/11"));
      expect(put).toBeTruthy();
      expect(put!.body).toMatchObject({ 职称: "主管", 出生日期: "1990-01-02" });
    });
  });

  it("删除人员走确认弹窗", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("李四"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText(/确认删除人员 E002 李四/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/master/employees/12"))).toBe(true);
    });
  });

  it("新增部门 POST;双击部门编辑编号锁定并带原编号 PUT", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByRole("button", { name: /新增部门/ }));
    await waitFor(() => expect(screen.getByLabelText("部门名称")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("部门编号"), { target: { value: "D03" } });
    fireEvent.change(screen.getByLabelText("部门名称"), { target: { value: "质检部" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/master/departments"));
      expect(post!.body).toEqual({ 编号: "D03", 部门: "质检部", 备注: "" });
    });
    fireEvent.doubleClick(screen.getByText("装配部(1)"));
    await waitFor(() => expect(screen.getByLabelText("部门编号")).toHaveValue("D01"));
    expect(screen.getByLabelText("部门编号")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("部门名称"), { target: { value: "装配一部" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/master/departments/1"));
      expect(put!.body).toMatchObject({ 编号: "D01", 部门: "装配一部" });
    });
  });

  it("删除有人员的部门:确认弹窗提示引用人数,仍允许删除", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByLabelText("删除部门 装配部"));
    await waitFor(() => expect(screen.getByText("确认删除部门 装配部?")).toBeInTheDocument());
    expect(screen.getByText("该部门下还有 1 名人员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/master/departments/1"))).toBe(true);
    });
  });

  it("无「人事档案·单价」位:基本工资列显示 ***,表单隐藏该字段", async () => {
    setup(PERMS_NOPRICE);
    await waitList();
    await waitFor(() => expect(screen.getAllByText("***").length).toBeGreaterThan(0));
    expect(screen.queryByText("5000")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    await waitFor(() => expect(screen.getByLabelText("编号")).toBeInTheDocument());
    expect(screen.queryByLabelText("基本工资")).not.toBeInTheDocument();
  });

  it("无「人事档案·打开」:显示无权面板", async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText("无权访问该页面")).toBeInTheDocument());
  });
});
