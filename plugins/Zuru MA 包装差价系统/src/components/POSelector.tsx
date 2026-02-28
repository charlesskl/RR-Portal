"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ChevronRight, AlertTriangle, Printer } from "lucide-react";
import {
  SchedulePORow,
  SCHEDULE_PACKAGING_COLUMNS,
  MARecord,
  InvoiceLineItem,
  findTieredMaterial,
} from "@/lib/data";
import {
  findQuotationForItem,
  getTierIndex,
  getTierLabel,
  QuotationItem,
} from "@/lib/parseQuotation";
import { getScheduleRows, getMARecords, getQuotationItems, saveInvoice } from "@/lib/store";
import InvoiceView from "./InvoiceView";

export default function POSelector({ onInvoiceSaved }: { onInvoiceSaved: () => void }) {
  const [scheduleRows, setScheduleRows] = useState<SchedulePORow[]>([]);
  const [maRecords, setMARecords] = useState<MARecord[]>([]);
  const [quotations, setQuotations] = useState<QuotationItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPO, setSelectedPO] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [maOverrides, setMaOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    setScheduleRows(getScheduleRows());
    setMARecords(getMARecords());
    setQuotations(getQuotationItems());
  }, []);

  // Unique POs
  const uniquePOs = useMemo(() => {
    const poMap = new Map<string, { poNumber: string; rows: SchedulePORow[] }>();
    for (const row of scheduleRows) {
      if (!poMap.has(row.poNumber)) {
        poMap.set(row.poNumber, { poNumber: row.poNumber, rows: [] });
      }
      poMap.get(row.poNumber)!.rows.push(row);
    }
    return Array.from(poMap.values());
  }, [scheduleRows]);

  // Filter
  const filteredPOs = useMemo(() => {
    if (!search.trim()) return uniquePOs;
    const q = search.toLowerCase();
    return uniquePOs.filter(
      (po) =>
        po.poNumber.toLowerCase().includes(q) ||
        po.rows.some((r) => r.itemNumber.toLowerCase().includes(q))
    );
  }, [uniquePOs, search]);

  // Selected PO rows
  const selectedRows = useMemo(() => {
    if (!selectedPO) return [];
    return scheduleRows.filter((r) => r.poNumber === selectedPO);
  }, [selectedPO, scheduleRows]);

  // Find MA for a column (user selects which MA to use for tier pricing)
  const findMA = (column: string): MARecord | null => {
    const overrideId = maOverrides[column];
    if (overrideId) {
      const ma = maRecords.find((m) => m.id === overrideId);
      if (ma) return ma;
    }
    // Default: latest MA (by date) for this column
    const columnMAs = maRecords
      .filter((m) => m.materialColumn === column)
      .sort((a, b) => b.date.localeCompare(a.date));
    return columnMAs[0] || null;
  };

  const getMAsForColumn = (column: string): MARecord[] => {
    return maRecords.filter((m) => m.materialColumn === column);
  };

  // Calculate line items
  useEffect(() => {
    if (!selectedPO) {
      setLineItems([]);
      setWarnings([]);
      return;
    }

    const rows = scheduleRows.filter((r) => r.poNumber === selectedPO);
    const items: InvoiceLineItem[] = [];
    const warns: string[] = [];

    for (const row of rows) {
      // Find quotation for this item
      const quotation = findQuotationForItem(row.itemNumber, quotations);

      for (const [column, qty] of Object.entries(row.packagingQty)) {
        if (!qty || qty <= 0) continue;

        const materialName = SCHEDULE_PACKAGING_COLUMNS[column] || column;

        // Find MA
        const ma = findMA(column);
        if (!ma) {
          warns.push(`${row.itemNumber}: 找不到 ${materialName} 的 MA`);
          continue;
        }

        // Find matching tiered material from quotation
        let maTierPrice = 0;
        let poTierPrice = 0;
        let quotationSheet = "";
        let quotationMaterial = "";

        if (quotation) {
          const matched = findTieredMaterial(column, quotation);
          if (matched) {
            const maTierIdx = getTierIndex(ma.quantity);
            const poTierIdx = getTierIndex(row.poQuantity);
            maTierPrice = matched.material.tierPrices[maTierIdx];
            poTierPrice = matched.material.tierPrices[poTierIdx];
            quotationSheet = quotation.sheetName;
            quotationMaterial = matched.material.name;
          } else {
            warns.push(
              `${row.itemNumber}: 报价表 "${quotation.sheetName}" 找不到 ${materialName} 的阶梯价`
            );
          }
        } else {
          warns.push(
            `${row.itemNumber}: 找不到对应的报价表，无法计算阶梯价`
          );
        }

        // priceDiff = MA tier price - PO tier price
        // When MA bulk is cheaper, diff is negative (credit/discount)
        // When PO tier is cheaper (unlikely), diff is positive
        const priceDiff = maTierPrice - poTierPrice;
        const chargeAmount = Math.round(priceDiff * qty * 100) / 100;

        items.push({
          poNumber: row.poNumber,
          itemNumber: row.itemNumber,
          productName: row.productName,
          poQuantity: row.poQuantity,
          materialColumn: column,
          materialName,
          materialQty: qty,
          quotationSheet,
          quotationMaterial,
          maNumber: ma.maNumber,
          maQty: ma.quantity,
          maTierLabel: getTierLabel(ma.quantity),
          maTierPrice,
          poTierLabel: getTierLabel(row.poQuantity),
          poTierPrice,
          priceDiff,
          chargeAmount,
        });
      }
    }

    setLineItems(items);
    setWarnings(warns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPO, scheduleRows, maRecords, quotations, maOverrides]);

  const totalCharge = Math.round(lineItems.reduce((sum, i) => sum + i.chargeAmount, 0) * 100) / 100;

  const handleSelectPO = (poNumber: string) => {
    setSelectedPO(poNumber);
    setShowInvoice(false);
    setMaOverrides({});
  };

  const handleSaveInvoice = () => {
    if (!selectedPO || lineItems.length === 0) return;
    const firstRow = selectedRows[0];
    saveInvoice({
      id: `inv-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      poNumber: selectedPO,
      customerPO: firstRow?.customerPO || "",
      customer: firstRow?.customer || "",
      lineItems,
      totalCharge,
    });
    setShowInvoice(true);
    onInvoiceSaved();
  };

  // Error states
  if (scheduleRows.length === 0 || quotations.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <AlertTriangle size={24} className="text-warning mx-auto mb-2" />
        <p className="text-sm font-medium text-amber-900">
          {scheduleRows.length === 0 && quotations.length === 0
            ? "尚未导入排期表及报价表"
            : scheduleRows.length === 0
            ? "尚未导入排期表"
            : "尚未导入报价表"}
        </p>
        <p className="text-sm text-amber-700 mt-1">请先到「导入排期表」页面上传 Excel 文件</p>
      </div>
    );
  }

  if (showInvoice && selectedPO) {
    return (
      <InvoiceView
        poNumber={selectedPO}
        customerPO={selectedRows[0]?.customerPO || ""}
        customer={selectedRows[0]?.customer || ""}
        lineItems={lineItems}
        totalCharge={totalCharge}
        onBack={() => setShowInvoice(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: PO List */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground mb-3">选择 PO</h2>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索 PO 号码或 Item..."
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
              {filteredPOs.map((po) => {
                const items = [...new Set(po.rows.map((r) => r.itemNumber))];
                const totalQty = po.rows.reduce((s, r) => s + r.poQuantity, 0);
                return (
                  <button
                    key={po.poNumber}
                    onClick={() => handleSelectPO(po.poNumber)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                      selectedPO === po.poNumber ? "bg-primary/5 border-l-2 border-l-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-medium">{po.poNumber}</span>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {items.join(", ")} | {totalQty.toLocaleString()} pcs
                    </div>
                  </button>
                );
              })}
              {filteredPOs.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  找不到符合的 PO
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Calculation */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedPO ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <p className="text-muted-foreground">请从左边选择一个 PO 号码</p>
            </div>
          ) : (
            <>
              {/* PO Info */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-base font-semibold text-foreground mb-3">
                  PO: <span className="font-mono">{selectedPO}</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">ITEM#</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">PO 数量</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">PO 阶梯</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">对应报价表</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">包装物料</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedRows.map((row) => {
                        const q = findQuotationForItem(row.itemNumber, quotations);
                        return (
                          <tr key={row.rowNum}>
                            <td className="px-3 py-2 font-medium">{row.itemNumber}</td>
                            <td className="px-3 py-2 text-right font-mono">{row.poQuantity.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                                {getTierLabel(row.poQuantity)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {q ? (
                                <span className="text-xs text-green-700">{q.sheetName}</span>
                              ) : (
                                <span className="text-xs text-destructive">未匹配</span>

                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {Object.entries(row.packagingQty)
                                .map(([col, qty]) => `${SCHEDULE_PACKAGING_COLUMNS[col] || col}: ${qty.toLocaleString()}`)
                                .join(" | ")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MA Selection */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  MA 匹配（自动 FIFO，可手动更改）
                </h3>
                <div className="space-y-2">
                  {(() => {
                    const cols = new Set<string>();
                    for (const row of selectedRows) {
                      for (const col of Object.keys(row.packagingQty)) {
                        cols.add(col);
                      }
                    }
                    return Array.from(cols).map((col) => {
                      const ma = findMA(col);
                      const allMAs = getMAsForColumn(col);
                      const colName = SCHEDULE_PACKAGING_COLUMNS[col] || col;
                      return (
                        <div key={col} className="flex items-center gap-3 text-sm">
                          <span className="w-44 shrink-0 text-muted-foreground">{colName}</span>
                          {allMAs.length > 0 ? (
                            <select
                              value={ma?.id || ""}
                              onChange={(e) => setMaOverrides((prev) => ({ ...prev, [col]: e.target.value }))}
                              className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                              {allMAs.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.maNumber} | 数量: {m.quantity.toLocaleString()} ({getTierLabel(m.quantity)})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-destructive">无可用 MA</span>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Calculation Table */}
              {lineItems.length > 0 && (
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-5 py-4 border-b border-border">
                    <h3 className="text-base font-semibold text-foreground">差价计算明细</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">ITEM#</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">物料</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">报价表物料</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">数量</th>
                          <th className="text-center px-3 py-2 font-medium text-muted-foreground">MA 阶梯</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">MA 单价</th>
                          <th className="text-center px-3 py-2 font-medium text-muted-foreground">PO 阶梯</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">PO 单价</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">差价/pc</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">应收差额</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {lineItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="px-3 py-2">{item.itemNumber}</td>
                            <td className="px-3 py-2 text-xs">{item.materialName}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{item.quotationMaterial || "-"}</td>
                            <td className="px-3 py-2 text-right font-mono">{item.materialQty.toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              <span className="text-xs px-1.5 py-0.5 bg-green-50 text-green-700 rounded">{item.maTierLabel}</span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-green-700">
                              {item.maTierPrice > 0 ? `$${item.maTierPrice.toFixed(3)}` : "-"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="text-xs px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded">{item.poTierLabel}</span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-orange-700">
                              {item.poTierPrice > 0 ? `$${item.poTierPrice.toFixed(3)}` : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-medium">
                              {item.priceDiff !== 0 ? (
                                <span className={item.priceDiff < 0 ? "text-destructive" : "text-success"}>
                                  {item.priceDiff < 0 ? "" : "+"}${item.priceDiff.toFixed(3)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">$0</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold">
                              {item.chargeAmount !== 0 ? (
                                <span className={item.chargeAmount < 0 ? "text-destructive" : "text-success"}>
                                  ${item.chargeAmount.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">$0.00</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/50 font-medium">
                          <td colSpan={9} className="px-3 py-3 text-right">合计 MA 调整金额:</td>
                          <td className="px-3 py-3 text-right font-mono text-lg font-bold text-primary">
                            {totalCharge < 0 ? "-" : ""}${Math.abs(totalCharge).toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveInvoice}
                  disabled={lineItems.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Printer size={16} />
                  生成 Invoice
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
