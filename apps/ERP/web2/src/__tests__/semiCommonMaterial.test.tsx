// 半成品共用物料表:纯函数(params 构造/价格遮蔽/跳转 URL/筛选持久化,移植老系统
// semiFinishedCommonMaterials.test.ts 场景) + 页面(权限遮蔽/双击存筛选跳装配物料设置)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import {
  buildAssemblyMaterialDetailUrl,
  buildSemiCommonMaterialParams,
  loadSemiCommonMaterialFilters,
  maskSemiCommonMaterialPrice,
  saveSemiCommonMaterialFilters,
  SEMI_COMMON_MATERIAL_FILTER_KEY,
} from "@/lib/semiCommonMaterial";
import SemiCommonMaterialPage from "@/pages/SemiCommonMaterialPage";

describe("半成品共用物料表·纯函数", () => {
  it("buildSemiCommonMaterialParams:「全部」/空白不下发,分页默认与上限", () => {
    expect(buildSemiCommonMaterialParams({})).toEqual({ page: 1, size: 50, 精确: false });
    expect(
      buildSemiCommonMaterialParams({
        field: "配件编号",
        keyword: " AAA ",
        exact: true,
        duplicate: "显示重复",
        pending: "待设置",
        audit: "未审核",
        page: 3,
        size: 500,
      }),
    ).toEqual({
      page: 3,
      size: 200,
      精确: true,
      查询字段: "配件编号",
      keyword: "AAA",
      重复内容: "显示重复",
      待操作物料: "待设置",
      审核情况: "未审核",
    });
    expect(buildSemiCommonMaterialParams({ duplicate: "全部", audit: "全部" })).toEqual({
      page: 1,
      size: 50,
      精确: false,
    });
  });

  it("buildAssemblyMaterialDetailUrl:编码 款号 与 return", () => {
    expect(buildAssemblyMaterialDetailUrl("9215/A")).toBe(
      `/assembly-material-setup?款号=${encodeURIComponent("9215/A")}&return=${encodeURIComponent("/semi-finished-common-materials")}`,
    );
  });

  it("maskSemiCommonMaterialPrice:无权限或空价遮蔽 ***", () => {
    expect(maskSemiCommonMaterialPrice(1.5, true)).toBe(1.5);
    expect(maskSemiCommonMaterialPrice(1.5, false)).toBe("***");
    expect(maskSemiCommonMaterialPrice(null, true)).toBe("***");
  });

  it("筛选 sessionStorage 往返;坏数据/错类型字段丢弃", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    saveSemiCommonMaterialFilters({ field: "客户", keyword: "ZURU", exact: true, page: 2 }, storage);
    expect(loadSemiCommonMaterialFilters(storage)).toEqual({
      field: "客户",
      keyword: "ZURU",
      exact: true,
      page: 2,
    });
    store.set(SEMI_COMMON_MATERIAL_FILTER_KEY, "not-json");
    expect(loadSemiCommonMaterialFilters(storage)).toEqual({});
    store.set(SEMI_COMMON_MATERIAL_FILTER_KEY, JSON.stringify({ field: 1, page: "x", audit: "已审核" }));
    expect(loadSemiCommonMaterialFilters(storage)).toEqual({ audit: "已审核" });
  });
});

// ---------- 页面 ----------

const PERMS = [
  { 组: "半成品仓库", 菜单: "半成品共用物料表", 打开: true, 单价: true, 打印: true },
];

const LIST = {
  items: [
    {
      产品货号: "9215A",
      客户: "ZURU",
      产品名称: "恐龙",
      产品装配名称: "彩盒",
      库存单价: 1.25,
      配件编号: "AAA0001",
      共用物料编号: "CM-1",
      调整审核: "未审核",
      备注内容: "备注X",
    },
  ],
  total: 1,
};

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

function installFetch(perms: unknown = PERMS) {
  const calls: { url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/semi-finished-common-materials") return json(LIST);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SemiCommonMaterialPage", () => {
  it("首屏查询带默认参数;渲染行(单价可见);调整审核徽章", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiCommonMaterialPage />, "/semi-finished-common-materials");
    await screen.findByText("9215A");
    expect(screen.getByText("彩盒")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getAllByText("未审核").some((el) => el.className.includes("b45309"))).toBe(true);
    const first = calls.find((c) => c.url.includes("/semi-finished-common-materials?"));
    expect(first?.url).toContain("page=1");
    expect(first?.url).toContain(encodeURIComponent("产品货号"));
  });

  it("无「单价」位:库存单价遮蔽 ***;导出按钮禁用态跟随打印位", async () => {
    installFetch([{ 组: "半成品仓库", 菜单: "半成品共用物料表", 打开: true }]);
    renderWithProviders(<SemiCommonMaterialPage />, "/semi-finished-common-materials");
    await screen.findByText("9215A");
    expect(screen.getByText("***")).toBeInTheDocument();
    expect(screen.queryByText("1.25")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /导出EXCEL/ })).toBeDisabled(),
    );
  });

  it("双击行:筛选写入 sessionStorage 并跳装配物料设置(带 款号+return)", async () => {
    installFetch();
    renderWithProviders(<SemiCommonMaterialPage />, "/semi-finished-common-materials");
    const cell = await screen.findByText("9215A");
    fireEvent.doubleClick(cell.closest("tr")!);
    await waitFor(() => {
      const saved = sessionStorage.getItem(SEMI_COMMON_MATERIAL_FILTER_KEY);
      expect(saved).toBeTruthy();
      expect(JSON.parse(saved!)).toMatchObject({ field: "产品货号", page: 1 });
    });
  });
});
