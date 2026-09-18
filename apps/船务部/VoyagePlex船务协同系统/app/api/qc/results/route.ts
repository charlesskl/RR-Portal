import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";

type LookupItem = { contractNumber: string; customerPo: string; itemNumber: string };
type QcRecord = {
  planId: string; site: string; inspectionDate: string | null; customer: string;
  contractNumber: string; customerPo: string; itemNumber: string; productName: string;
  internalResult: string; thirdPartyResult: string; holdRejectReason: string; workflowStatus: string;
};
type QcMatch = { itemIndex: number; total: number; latest: QcRecord | null };

function lookupParameters(item: LookupItem) {
  const params = new URLSearchParams();
  if (item.contractNumber && item.itemNumber) {
    params.set("contractNumber", item.contractNumber);
    params.set("itemNumber", item.itemNumber);
  } else if (item.customerPo && item.itemNumber) {
    params.set("customerPo", item.customerPo);
    params.set("itemNumber", item.itemNumber);
  } else if (item.contractNumber && item.customerPo) {
    params.set("contractNumber", item.contractNumber);
    params.set("customerPo", item.customerPo);
  } else if (item.itemNumber) params.set("itemNumber", item.itemNumber);
  else if (item.customerPo) params.set("customerPo", item.customerPo);
  else if (item.contractNumber) params.set("contractNumber", item.contractNumber);
  return params;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["admin", "shipping"]);
  if (auth.response) return auth.response;

  const qcSystemUrl = process.env.QC_SYSTEM_API_URL?.trim();
  const token = process.env.QC_SYSTEM_API_TOKEN?.trim();
  if (!qcSystemUrl || !token) return NextResponse.json({ error: "尚未配置 QC 验货系统地址或接口密钥" }, { status: 503 });

  let target: URL;
  try { target = new URL(qcSystemUrl); }
  catch { return NextResponse.json({ error: "QC 验货系统地址无效" }, { status: 503 }); }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "查询内容不是有效 JSON" }, { status: 400 }); }
  const values = (raw as { items?: unknown })?.items;
  if (!Array.isArray(values) || values.length < 1 || values.length > 500)
    return NextResponse.json({ error: "货物明细数量须为 1 至 500 条" }, { status: 400 });
  const items: LookupItem[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") return NextResponse.json({ error: "货物明细格式无效" }, { status: 400 });
    const row = value as Record<string, unknown>;
    const fields = [row.contractNumber, row.customerPo, row.itemNumber];
    if (fields.some(field => typeof field !== "string" || field.length > 100))
      return NextResponse.json({ error: "合同号、客户 PO 或货号格式无效" }, { status: 400 });
    items.push({ contractNumber: (row.contractNumber as string).trim(), customerPo: (row.customerPo as string).trim(), itemNumber: (row.itemNumber as string).trim() });
  }

  const queries = items.map(item => lookupParameters(item).toString());
  const unique = Array.from(new Set(queries.filter(Boolean)));
  const batchUrl = new URL(target);
  batchUrl.pathname = `${batchUrl.pathname.replace(/\/$/, "")}/batch`;
  const batchItems = unique.map(query => {
    const params = new URLSearchParams(query);
    return { contractNumber: params.get("contractNumber") || "", customerPo: params.get("customerPo") || "", itemNumber: params.get("itemNumber") || "" };
  });
  const matches = new Map<string, QcMatch>();
  try {
    if (unique.length) {
      const response = await fetch(batchUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ items: batchItems }), cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) throw new Error("QC 接口密钥无效");
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || `QC 系统返回 ${response.status}`);
      }
      const result = await response.json() as { results?: QcMatch[] };
      if (!Array.isArray(result.results) || result.results.length !== unique.length || result.results.some((row, index) => row.itemIndex !== index || typeof row.total !== "number" || (row.latest !== null && typeof row.latest !== "object")))
        throw new Error("QC 系统返回格式无效");
      result.results.forEach((row, index) => matches.set(unique[index], row));
    }
  } catch (error) {
    return NextResponse.json({ error: `查询 QC 验货结果失败：${error instanceof Error ? error.message : "连接失败"}` }, { status: 502 });
  }

  return NextResponse.json({ results: queries.map((query, index) => ({
    itemIndex: index,
    total: matches.get(query)?.total ?? 0,
    latest: matches.get(query)?.latest ?? null,
  })) });
}
