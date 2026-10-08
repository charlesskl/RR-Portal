import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { FolderOpen, Trash } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { DocToolbar, type DocAction } from "@/components/doc/DocToolbar";
import { FlowSteps } from "@/components/doc/FlowSteps";
import { OpenDocDialog } from "@/components/doc/OpenDocDialog";

// 「生产通知单」菜单有打开权限、无删除权限
const PERMS_NO_DELETE = [
  {
    组: "工程部",
    菜单: "生产通知单",
    打开: true,
    保存: true,
    删除: false,
    打印: true,
    单价: false,
    金额: false,
    审核: true,
    反审核: false,
    功能: false,
  },
];

function stubPerms(rows: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/auth/me/permissions")
        ? JSON.stringify(permRowsToMap(rows))
        : "null";
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("共享单据骨架", () => {
  it("无删除权限时 DocToolbar 不渲染删除按钮", async () => {
    localStorage.setItem("web2.user", "tester");
    stubPerms(PERMS_NO_DELETE);
    const actions: DocAction[] = [
      {
        key: "open",
        label: "打开",
        icon: FolderOpen,
        perm: "打开",
        primary: true,
        onClick: () => {},
      },
      {
        key: "del",
        label: "删除",
        icon: Trash,
        perm: "删除",
        danger: true,
        onClick: () => {},
      },
    ];
    renderWithProviders(<DocToolbar actions={actions} />, "/production");
    await waitFor(() =>
      expect(screen.queryByText("删除")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("打开")).toBeInTheDocument();
  });

  it("FlowSteps current=2 时前两步绿勾、第三步高亮", () => {
    const { container } = renderWithProviders(
      <FlowSteps steps={["开单", "主管审核", "经理审核", "审核出库"]} current={2} />,
      "/production",
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(4);
    const dot = (i: number) => items[i].querySelector("span")!;
    // 前两步:实心绿底 + 对勾图标
    expect(dot(0).className).toContain("bg-[#16a34a]");
    expect(dot(1).className).toContain("bg-[#16a34a]");
    expect(items[0].querySelector("svg")).toBeTruthy();
    expect(items[1].querySelector("svg")).toBeTruthy();
    // 第三步:绿色描边高亮,无对勾
    expect(dot(2).className).toContain("border-2");
    expect(dot(2).className).toContain("border-[#16a34a]");
    expect(items[2].querySelector("svg")).toBeNull();
    // 第四步:未到达,灰态
    expect(dot(3).className).not.toContain("bg-[#16a34a]");
    expect(dot(3).className).not.toContain("border-2");
  });

  it("菜单行缺失时 usePerms 拒绝对应动作", async () => {
    localStorage.setItem("web2.user", "tester");
    // 权限列表加载成功,但没有任何「生产通知单」菜单行
    stubPerms([{ 组: "基础设置", 菜单: "系统用户", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true }]);
    const actions: DocAction[] = [
      {
        key: "open",
        label: "打开",
        icon: FolderOpen,
        perm: "打开",
        primary: true,
        onClick: () => {},
      },
    ];
    renderWithProviders(<DocToolbar actions={actions} />, "/production");
    await waitFor(() =>
      expect(screen.queryByText("打开")).not.toBeInTheDocument(),
    );
  });

  it("OpenDocDialog 表头 th 带 sticky top-0 z-10 且背景不透明", () => {
    type Row = { no: string; qty: number };
    const columns: ColumnDef<Row>[] = [
      { accessorKey: "no", header: "单号", size: 50 },
      { accessorKey: "qty", header: "数量", size: 50 },
    ];
    renderWithProviders(
      <OpenDocDialog<Row>
        title="打开单据"
        open
        onClose={() => {}}
        columns={columns}
        rows={[{ no: "A1", qty: 3 }]}
        searchPlaceholder="单号"
        onPick={() => {}}
      />,
      "/production",
    );
    const ths = document.querySelectorAll("th");
    expect(ths.length).toBe(2);
    ths.forEach((th) => {
      expect(th.className).toContain("sticky top-0 z-10");
      expect(th.className).toContain("bg-white");
    });
  });
});
