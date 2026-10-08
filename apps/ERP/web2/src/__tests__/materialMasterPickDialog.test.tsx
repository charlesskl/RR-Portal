// 半成品设置选料弹窗(MaterialMasterPickDialog):
// 传 货号 时拉全量按「货号-」前缀规则过滤(含 92119/92125 共用料、款号列命中),关键字在结果内再搜;
// 不传 货号 保持服务端分页原样。匹配规则与 BOM 设置页自动带出同源(@/lib/materialMatch)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../test/setup";
import { MaterialMasterPickDialog } from "@/components/doc/MaterialMasterPickDialog";
import { 货号前缀, matchPrefix } from "@/lib/materialMatch";

const ROWS = [
  { ID: 1, 物料编号: "07020464", 物料名称: "92125-吊卡(3L版本)", 物料类别: "利宝说明书", 规格: "90*55MM", 颜色: "1C", 单位: "个" },
  { ID: 2, 物料编号: "57001539", 物料名称: "92119/92125-手链蛋黄形件", 物料类别: "塑胶", 规格: "", 颜色: "", 单位: "个" },
  { ID: 3, 物料编号: "09010536", 物料名称: "92125-中文毛绒公仔(粉)", 物料类别: "毛绒", 规格: "", 颜色: "粉", 单位: "个" },
  { ID: 4, 物料编号: "08030001", 物料名称: "无名共用件", 款号: "92125/92119", 物料类别: "五金", 规格: "", 颜色: "", 单位: "个" },
  { ID: 5, 物料编号: "07020465", 物料名称: "92119-猫脸贴纸", 物料类别: "利宝说明书", 规格: "", 颜色: "", 单位: "个" },
  { ID: 6, 物料编号: "01030008", 物料名称: "PB螺丝", 物料类别: "五金", 规格: "2.6*6PB", 颜色: "镀兰锌", 单位: "个" },
];

const ROWS_PLASTIC = [
  { ID: 11, 物料编号: "57001644", 物料名称: "铲子", 物料类别: "塑胶", 款号: "92125", 规格: "", 颜色: "半透幻彩紫", 单位: "个" },
  { ID: 12, 物料编号: "57001539", 物料名称: "与物料资料同编号的塑胶件", 物料类别: "塑胶", 款号: "92125", 规格: "", 颜色: "", 单位: "个" },
  { ID: 13, 物料编号: "57009999", 物料名称: "别家塑胶件", 物料类别: "塑胶", 款号: "77772", 规格: "", 颜色: "", 单位: "个" },
];

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

function installFetch({ withPlastic = false } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const p = new URL(String(input), "http://test").pathname;
      if (p === "/api/master/materials") return json({ items: ROWS, total: ROWS.length });
      if (p === "/api/plastic-material-master" && withPlastic)
        return json({ items: ROWS_PLASTIC, total: ROWS_PLASTIC.length });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
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

describe("materialMatch 纯函数", () => {
  it("货号前缀:92125-MA → 92125;无横杠原样", () => {
    expect(货号前缀("92125-MA")).toBe("92125");
    expect(货号前缀("92125")).toBe("92125");
  });

  it("matchPrefix:专属/共用/款号列命中;他货号专属不命中", () => {
    const [专属, 共用在前, , 款号列, 他货号, 无关] = ROWS;
    expect(matchPrefix(专属, "92125-MA")).toBe(true);
    expect(matchPrefix(共用在前, "92125-MA")).toBe(true);
    expect(matchPrefix({ 物料名称: "92125/92119-贴纸" }, "92125-MA")).toBe(true);
    expect(matchPrefix(款号列, "92125-MA")).toBe(true);
    expect(matchPrefix(他货号, "92125-MA")).toBe(false);
    expect(matchPrefix(无关, "92125-MA")).toBe(false);
    // 反向:92119 命中共用件与他货号专属
    expect(matchPrefix(共用在前, "92119")).toBe(true);
    expect(matchPrefix(他货号, "92119")).toBe(true);
  });
});

describe("MaterialMasterPickDialog · 货号过滤", () => {
  it("只显示该货号(含共用/款号列)物料,标题带货号", async () => {
    installFetch();
    renderWithProviders(
      <MaterialMasterPickDialog open 货号="92125-MA" onPick={() => {}} onClose={() => {}} />,
    );
    await screen.findByText("92125-吊卡(3L版本)");
    expect((await screen.findAllByText("选择物料 · 92125-MA")).length).toBeGreaterThan(0);
    expect(screen.getByText("92119/92125-手链蛋黄形件")).toBeInTheDocument();
    expect(screen.getByText("92125-中文毛绒公仔(粉)")).toBeInTheDocument();
    expect(screen.getByText("无名共用件")).toBeInTheDocument();
    expect(screen.queryByText("92119-猫脸贴纸")).not.toBeInTheDocument();
    expect(screen.queryByText("PB螺丝")).not.toBeInTheDocument();
    expect(screen.getByText(/共 4 条/)).toBeInTheDocument();
  });

  it("关键字在货号过滤结果内再搜;点行回调 onPick/onClose", async () => {
    installFetch();
    const onPick = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <MaterialMasterPickDialog open 货号="92125-MA" onPick={onPick} onClose={onClose} />,
    );
    await screen.findByText("92125-吊卡(3L版本)");
    fireEvent.change(screen.getByLabelText("物料搜索"), { target: { value: "吊卡" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(await screen.findByText(/共 1 条/)).toBeInTheDocument();
    expect(screen.queryByText("无名共用件")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("92125-吊卡(3L版本)"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ 物料编号: "07020464" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("不传 货号:服务端分页模式,原样显示返回行", async () => {
    installFetch();
    renderWithProviders(<MaterialMasterPickDialog open onPick={() => {}} onClose={() => {}} />);
    await screen.findByText("PB螺丝");
    expect(screen.getByText("92119-猫脸贴纸")).toBeInTheDocument();
    expect(screen.getByText(/共 6 条/)).toBeInTheDocument();
  });

  it("货号模式并入塑胶物料资料:塑胶件可选,同编号不重复,他货号塑胶件不带出", async () => {
    installFetch({ withPlastic: true });
    renderWithProviders(
      <MaterialMasterPickDialog open 货号="92125-MA" onPick={() => {}} onClose={() => {}} />,
    );
    // 塑胶件(57001644 铲子,款号=92125)并入显示
    await screen.findByText("铲子");
    // 与物料资料同编号(57001539)的塑胶件不重复并入
    expect(screen.queryByText("与物料资料同编号的塑胶件")).not.toBeInTheDocument();
    expect(screen.getAllByText("57001539").length).toBe(1);
    // 他货号(77772)塑胶件不带出;总数 = 物料资料 4 + 塑胶 1
    expect(screen.queryByText("别家塑胶件")).not.toBeInTheDocument();
    expect(screen.getByText(/共 5 条/)).toBeInTheDocument();
  });
});
