import { afterEach, expect, it, vi } from "vitest";
import { MENU_TREE } from "@/nav/menu";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
it("船务共用菜单只保留准确的 VoyagePlex 新入口", () => {
  const entries = MENU_TREE.flatMap(group => group.children);
  expect(entries.filter(entry => entry.label.includes("VoyagePlex"))).toEqual([{ label: "VoyagePlex 船务协同系统↗", path: "http://8.148.146.194/voyageplex/" }]);
  expect(entries.some(entry => entry.path === "http://8.148.146.194/shipping/")).toBe(false);
});
it("云端新增 API 保留 /erp 前缀，来源单号和账号按路径编码", async () => {
  vi.stubEnv("BASE_URL", "/erp/"); vi.resetModules();
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => { paths.push(String(input)); return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }); }));
  const { rawStockIssueApi, rawMaterialDemandApi, rawPurchaseOrderApi, accountApi, imageNoteUrl } = await import("@/api/endpoints");
  await rawStockIssueApi.access(); await rawStockIssueApi.source("SP 甲/1");
  await rawStockIssueApi.makerOptions("文员"); await rawMaterialDemandApi.moldingSource("SP 甲/1");
  await rawPurchaseOrderApi.purchaseLimits(); await accountApi.saveRawWorkflowRole("clerk one", "06-clerk");
  expect(paths.every(path => path.startsWith("/erp/api/"))).toBe(true);
  expect(paths).toContain("/erp/api/plastic-raw-material-stock-issue/sources/SP%20%E7%94%B2%2F1");
  expect(paths).toContain("/erp/api/admin/accounts/clerk%20one/raw-workflow-role");
  expect(imageNoteUrl({ ID: 1, 模块: "fixture", 单号: "fixture", 存储路径: "uploads/fixture.png" })).toBe("/erp/uploads/fixture.png");
});
