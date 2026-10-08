// 半成品出仓单(/semi-outbound)= 来料领料单仓侧别名:页标题/页签显示为半成品出仓,
// 权限菜单仍是「来料领料单」(老系统菜单 M("半成品出仓单","/semi-outbound","来料领料单"))。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SemiOutboundPage from "@/pages/SemiOutboundPage";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * size, size, key: i })),
      measure: () => {},
    };
  },
}));

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions"))
        return json(permRowsToMap([{ 组: "物料管理", 菜单: "来料领料单", 打开: true, 保存: true, 审核: true }]));
      if (p === "/api/material-issues") return json({ items: [], total: 0 });
      if (p === "/api/material-issues/first") return json(null);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SemiOutboundPage(半成品出仓单别名)", () => {
  it("标题/页签显示 半成品出仓,不出现 来料领料单 标题", async () => {
    installFetch();
    renderWithProviders(<SemiOutboundPage />, "/semi-outbound");
    await screen.findByRole("button", { name: "半成品出仓查询" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("半成品出仓");
    expect(screen.getByRole("button", { name: "半成品出仓单" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /来料领料单/ })).not.toBeInTheDocument();
  });
});
