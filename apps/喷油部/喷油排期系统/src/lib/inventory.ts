import { prisma } from "./db";

export type StepStock = {
  stepNo: number;
  craft: string;
  totalGood: number;   // 该工序累计完成数
  backlog: number;     // 该工序后积压数
};

export type InventoryRow = {
  productId: number;
  productNo: string;
  partName: string;
  orderNos: string;    // 关联订单号（逗号分隔）
  steps: StepStock[];
  wipTotal: number;    // 半成品库存合计（非最后工序积压之和）
  finishedStock: number;   // 成品库存（最后工序入库累计）
  workshopStock: number;   // 车间存数（最后工序完成未入库）
};

export type RawInventoryRow = {
  productId: number;
  productNo: string;
  orderId: number;
  orderNo: string;
  partName: string;
  stepNo: number;
  craft: string;
  totalGood: number | bigint;
  totalInbound: number | bigint;
};

type OrderStepStock = StepStock & { totalInbound: number };

export function calculateInventoryRows(rawRows: RawInventoryRow[]): InventoryRow[] {
  const orderGroups = new Map<string, RawInventoryRow[]>();
  for (const row of rawRows) {
    const key = `${row.productId}\0${row.partName}\0${row.orderId}`;
    const group = orderGroups.get(key);
    if (group) group.push(row);
    else orderGroups.set(key, [row]);
  }

  const partGroups = new Map<string, Array<{
    source: RawInventoryRow;
    steps: OrderStepStock[];
  }>>();

  for (const rows of Array.from(orderGroups.values())) {
    const byStep = new Map<number, RawInventoryRow[]>();
    for (const row of rows) {
      const step = byStep.get(row.stepNo);
      if (step) step.push(row);
      else byStep.set(row.stepNo, [row]);
    }

    const ordered = Array.from(byStep.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepNo, stepRows]) => ({
        stepNo,
        craft: Array.from(new Set(stepRows.map((row) => row.craft).filter(Boolean))).join("/"),
        totalGood: stepRows.reduce((sum, row) => sum + Number(row.totalGood), 0),
        totalInbound: stepRows.reduce((sum, row) => sum + Number(row.totalInbound), 0),
      }));

    const steps = ordered.map((step, index): OrderStepStock => {
      const next = ordered[index + 1];
      const comparisonQty = next ? next.totalGood : step.totalInbound;
      return { ...step, backlog: Math.max(0, step.totalGood - comparisonQty) };
    });

    const source = rows[0];
    const partKey = `${source.productId}\0${source.partName}`;
    const group = partGroups.get(partKey);
    const value = { source, steps };
    if (group) group.push(value);
    else partGroups.set(partKey, [value]);
  }

  return Array.from(partGroups.values()).map((orders) => {
    const stepGroups = new Map<number, OrderStepStock[]>();
    for (const order of orders) {
      for (const step of order.steps) {
        const group = stepGroups.get(step.stepNo);
        if (group) group.push(step);
        else stepGroups.set(step.stepNo, [step]);
      }
    }

    const steps = Array.from(stepGroups.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepNo, rows]) => ({
        stepNo,
        craft: Array.from(new Set(rows.map((row) => row.craft).filter(Boolean))).join("/"),
        totalGood: rows.reduce((sum, row) => sum + row.totalGood, 0),
        backlog: rows.reduce((sum, row) => sum + row.backlog, 0),
      }));

    const source = orders[0].source;
    return {
      productId: source.productId,
      productNo: source.productNo,
      partName: source.partName,
      orderNos: Array.from(new Set(orders.map((order) => order.source.orderNo))).join(","),
      steps,
      wipTotal: orders.reduce(
        (sum, order) => sum + order.steps.slice(0, -1).reduce((stepSum, step) => stepSum + step.backlog, 0),
        0,
      ),
      finishedStock: orders.reduce((sum, order) => sum + (order.steps.at(-1)?.totalInbound ?? 0), 0),
      workshopStock: orders.reduce((sum, order) => sum + (order.steps.at(-1)?.backlog ?? 0), 0),
    };
  });
}

/**
 * 从 ProductionPlan 实时计算库存。
 * 
 * 逻辑：
 * 1. 按 (productId, partName, stepNo, craft) 汇总 SUM(goodQty) 和 SUM(inboundQty)
 * 2. 同一部位按 stepNo 升序排列
 * 3. 工序 i 积压 = 工序 i 累计完成 - 工序 i+1 累计完成
 * 4. 最后工序积压 = 最后工序累计完成 - 入库累计（= 车间存数）
 * 5. 成品库存 = 最后工序入库累计
 * 6. 半成品合计 = 所有非最后工序积压之和
 */
export async function queryInventory(): Promise<InventoryRow[]> {
  const rawRows = await prisma.$queryRaw<RawInventoryRow[]>`
    SELECT 
      p.id          AS productId,
      p.productNo   AS productNo,
      o.id          AS orderId,
      o.externalOrderNo AS orderNo,
      pp.partName   AS partName,
      pp.stepNo     AS stepNo,
      pp.craft      AS craft,
      SUM(COALESCE(pp.goodQty, 0))    AS totalGood,
      SUM(COALESCE(pp.inboundQty, 0)) AS totalInbound
    FROM production_plans pp
    JOIN orders o ON pp.orderId = o.id
    JOIN products p ON o.productId = p.id
    WHERE pp.deletedAt IS NULL
    GROUP BY p.id, p.productNo, o.id, o.externalOrderNo, pp.partName, pp.stepNo, pp.craft
    ORDER BY p.productNo, pp.partName, o.id, pp.stepNo
  `;
  return calculateInventoryRows(rawRows);
}
