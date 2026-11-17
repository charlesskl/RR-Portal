import { describe, expect, it } from "vitest";
import { balanceKey, livePlanBalances } from "../../../src/lib/livePlanBalances";
import { draftOf, type WorkbenchAllocationSource, type WorkbenchRow } from "../../../src/lib/planWorkbench";

const row = (id = 1): WorkbenchRow => ({ id, orderId: 1, orderNo: "O", token: "v1", productNo: "P", partName: "头", stepNo: 1, craft: "移印", demand: 500,
  goodQty: null, inboundQty: null, lockedReason: null,
  values: { planDate: "2030-01-07", lineId: 1, plannedQty: 100, machineNos: [], workerCount: 1, workHours: 11, remark: "" },
  balance: { orderId: 1, partName: "头", stepNo: 1, demand: 500, produced: 18, unreportedPlanned: 400, remainingToSchedule: 82, actualFallbackCount: 0 } });
const donor = (id = 10, qty = 300, date = "2030-05-07"): WorkbenchAllocationSource => ({ id, orderId: 1, partName: "头", stepNo: 1, planDate: date, plannedQty: qty, canDeduct: true });
const stats = (rows: WorkbenchRow[], drafts: Parameters<typeof livePlanBalances>[1], sources: WorkbenchAllocationSource[] | undefined = [], auto = false) => livePlanBalances(rows, drafts, sources, auto).get(balanceKey(rows[0]))!;

describe("实时排期统计", () => {
  it("直接按基线加草稿差额，覆盖增加、减少、还原且不累加重复计算", () => {
    const a = row(); const draft = { ...draftOf(a.values), plannedQty: "150" };
    expect(stats([a], { 1: draft }).balance).toMatchObject({ produced: 18, unreportedPlanned: 450, remainingToSchedule: 32 });
    expect(stats([a], { 1: draft }).balance?.unreportedPlanned).toBe(450);
    expect(stats([a], { 1: { ...draft, plannedQty: "80" } }).balance?.remainingToSchedule).toBe(102);
    expect(stats([a], {}).balance?.unreportedPlanned).toBe(400);
    expect(a.balance?.unreportedPlanned).toBe(400);
  });
  it("自动扣减范围外的可用计划并保持总量，不改写来源快照", () => {
    const a = row(); const sources = [donor()];
    expect(stats([a], { 1: { ...draftOf(a.values), plannedQty: "150" } }, sources, true).balance).toMatchObject({ unreportedPlanned: 400, remainingToSchedule: 82 });
    expect(sources[0].plannedQty).toBe(300);
  });
  it("手工减量抵消加量，不重复扣减；备注已编辑的来源不能再自动扣减", () => {
    const a = row(); const b = { ...row(2), values: { ...a.values, plannedQty: 300, planDate: "2030-05-07" } };
    expect(stats([a, b], { 1: { ...draftOf(a.values), plannedQty: "150" }, 2: { ...draftOf(b.values), plannedQty: "250" } }, [donor(2)], true).balance?.unreportedPlanned).toBe(400);
    const result = stats([a, b], { 1: { ...draftOf(a.values), plannedQty: "150" }, 2: { ...draftOf(b.values), remark: "手改" } }, [donor(2)], true);
    expect(result.issue).toContain("后续可扣减 0 件"); expect(result.balance?.unreportedPlanned).toBe(450);
  });
  it.each(["locked", "same-day", "earlier", "other-step", "other-part", "other-order"])("%s 的计划不能作为扣减来源", kind => {
    const source = donor();
    if (kind === "locked") source.canDeduct = false;
    if (kind === "same-day") source.planDate = "2030-01-07";
    if (kind === "earlier") source.planDate = "2030-01-06";
    if (kind === "other-step") source.stepNo = 2;
    if (kind === "other-part") source.partName = "脚";
    if (kind === "other-order") source.orderId = 2;
    const a = row(); const result = stats([a], { 1: { ...draftOf(a.values), plannedQty: "150" } }, [source], true);
    expect(result.issue).toContain("后续可扣减 0 件"); expect(result.balance?.unreportedPlanned).toBe(450);
  });
  it("新增先用尚未排期的需求，超过部分才从后续扣减", () => {
    const a = row(); const added = { ...row(-1), values: { ...a.values, plannedQty: 0 } };
    const calculate = (qty: string) => stats([a, added], { [-1]: { ...draftOf(added.values), plannedQty: qty } }, [donor()], true);
    expect(calculate("50").balance).toMatchObject({ unreportedPlanned: 450, remainingToSchedule: 32 });
    expect(calculate("100").balance).toMatchObject({ unreportedPlanned: 482, remainingToSchedule: 0 });
  });
  it("多个新增及加减量先净额抵消，再按日期扣减，不因列表顺序而变", () => {
    const a = row(); const added = { ...row(-1), values: { ...a.values, plannedQty: 0 } };
    const drafts = { 1: { ...draftOf(a.values), plannedQty: "50" }, [-1]: { ...draftOf(added.values), plannedQty: "150" } };
    expect(stats([a, added], drafts, [donor()], true).balance?.unreportedPlanned).toBe(482);
    expect(stats([added, a], drafts, [donor()], true).balance?.unreportedPlanned).toBe(482);
  });
  it("某目标来源不足时不显示部分成功扣减", () => {
    const a = row(); const b = { ...row(2), values: { ...a.values, planDate: "2030-05-08" } };
    const result = stats([a, b], { 1: { ...draftOf(a.values), plannedQty: "150" }, 2: { ...draftOf(b.values), plannedQty: "150" } }, [donor(10, 100, "2030-05-07")], true);
    expect(result.issue).toContain("后续可扣减 0 件"); expect(result.balance?.unreportedPlanned).toBe(500);
  });
  it.each(["", "0", "-1", "1.2", "1,00", "abc", "2147483648"])("数量 %s 输入中或无效时不显示伪造合计", qty => {
    const a = row(); const result = stats([a], { 1: { ...draftOf(a.values), plannedQty: qty } });
    expect(result.balance).toBeUndefined(); expect(result.issue).toContain("输入中或无效");
  });
  it("兼容千分位且尚需补排不小于零", () => {
    const a = row(); expect(stats([a], { 1: { ...draftOf(a.values), plannedQty: "1,000" } }).balance?.remainingToSchedule).toBe(0);
  });
  it("缺少基线与缺少扣减快照分别提示，不默认为零或假装已扣减", () => {
    const a = row();
    expect(stats([{ ...a, balance: undefined }], {}).balance).toBeUndefined();
    expect(livePlanBalances([a], { 1: { ...draftOf(a.values), plannedQty: "150" } }, undefined, true).get(balanceKey(a))?.issue).toContain("自动扣减资料未加载");
  });
  it("无效日期在自动扣减时提示，其他字段编辑不影响数量", () => {
    const a = row(); const draft = draftOf(a.values);
    expect(stats([a], { 1: { ...draft, planDate: "" } }, [], true).balance).toBeUndefined();
    expect(stats([a], { 1: { ...draft, remark: "新备注", workerCount: "" } }).balance?.unreportedPlanned).toBe(400);
  });
  it("过期或不一致的基线不能产生负的未报工数量", () => {
    const a = row(); a.balance = { ...a.balance!, unreportedPlanned: 0 };
    const result = stats([a], { 1: { ...draftOf(a.values), plannedQty: "50" } });
    expect(result.balance).toBeUndefined(); expect(result.issue).toContain("基线与计划不一致");
  });
});
