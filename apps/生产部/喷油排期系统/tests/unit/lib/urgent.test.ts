import { describe, it, expect } from "vitest";
import { urgentDays, slackDays, pickCandidates } from "@/lib/urgent";

// 急单核心纯函数：天数换算 / 能缓几天 / 候选凑数。详见 spec 2026-06-16-urgent-order-design §4、§6。

describe("urgentDays — 急单要占的生产天数 = ceil(数量 / (台数 × 日产能))", () => {
  it("整除", () => {
    expect(urgentDays(6000, 2, 1000)).toBe(3); // 6000 / 2000 = 3
  });
  it("有余数向上取整", () => {
    expect(urgentDays(6001, 2, 1000)).toBe(4); // 6001 / 2000 → 4
  });
  it("单台有余数", () => {
    expect(urgentDays(2500, 1, 1000)).toBe(3); // 2500 / 1000 = 2.5 → 3
  });
  it("日产能为 0（缺录入）→ 0", () => {
    expect(urgentDays(5000, 2, 0)).toBe(0);
  });
  it("台数为 0 → 0", () => {
    expect(urgentDays(5000, 0, 1000)).toBe(0);
  });
  it("数量为 0 → 0", () => {
    expect(urgentDays(0, 2, 1000)).toBe(0);
  });
});

describe("slackDays — 能缓几天 = 顺延后预计完成日仍不超交货日的最大天数", () => {
  it("交期还有 8 天缓冲 → 最多缓 8 天", () => {
    expect(slackDays(8)).toBe(8);
  });
  it("正好顶到交货日（缓冲 0）→ 不能缓", () => {
    expect(slackDays(0)).toBe(0);
  });
  it("已超期（负缓冲）→ 0（不适合停）", () => {
    expect(slackDays(-2)).toBe(0);
  });
});

describe("pickCandidates — 按能缓天数降序预勾，凑够急单所需天数", () => {
  const cs = [
    { id: 1, slack: 2 },
    { id: 2, slack: 1 },
    { id: 3, slack: 5 },
  ];

  it("单张够：缓 5 天的单覆盖 3 天需求", () => {
    const r = pickCandidates(cs, 3);
    expect(r.picked.map((c) => c.id)).toEqual([3]);
    expect(r.enough).toBe(true);
    expect(r.got).toBe(5);
  });

  it("两张凑：需 6 天 = 5 + 2", () => {
    const r = pickCandidates(cs, 6);
    expect(r.picked.map((c) => c.id)).toEqual([3, 1]);
    expect(r.enough).toBe(true);
    expect(r.got).toBe(7);
  });

  it("全部加起来仍凑不够 → enough=false，交人工", () => {
    const r = pickCandidates(cs, 99);
    expect(r.enough).toBe(false);
    expect(r.got).toBe(8); // 5+2+1 全选也只有 8
    expect(r.picked).toHaveLength(3);
  });

  it("slack<=0 的候选不参与（不适合停的不预勾）", () => {
    const withDead = [
      { id: 1, slack: 0 },
      { id: 2, slack: 3 },
      { id: 3, slack: -1 },
    ];
    const r = pickCandidates(withDead, 2);
    expect(r.picked.map((c) => c.id)).toEqual([2]);
    expect(r.enough).toBe(true);
  });

  it("需求为 0（不该触发候选）→ 不勾任何单", () => {
    const r = pickCandidates(cs, 0);
    expect(r.picked).toHaveLength(0);
    expect(r.enough).toBe(true);
  });
});
