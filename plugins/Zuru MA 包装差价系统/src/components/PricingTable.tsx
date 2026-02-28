"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { QuotationItem, TIER_LABELS } from "@/lib/parseQuotation";
import { getQuotationItems } from "@/lib/store";

export default function PricingTable() {
  const [quotations, setQuotations] = useState<QuotationItem[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  useEffect(() => {
    const items = getQuotationItems();
    setQuotations(items);
    if (items.length > 0) setSelectedSheet(items[0].sheetName);
  }, []);

  if (quotations.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <AlertTriangle size={24} className="text-warning mx-auto mb-2" />
        <p className="text-sm font-medium text-amber-900">尚未导入报价表</p>
        <p className="text-sm text-amber-700 mt-1">
          请先到「导入排期表」页面上传报价表 Excel 文件
        </p>
      </div>
    );
  }

  const selected = quotations.find((q) => q.sheetName === selectedSheet);

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex flex-col gap-4 mb-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">阶梯价格表</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              每个 Item 的包装物料阶梯价（只显示标记「有阶梯价」的物料）
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quotations.map((q) => (
              <button
                key={q.sheetName}
                onClick={() => setSelectedSheet(q.sheetName)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedSheet === q.sheetName
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {q.sheetName}
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <>
            {/* Item Info */}
            <div className="bg-muted/50 rounded-lg p-4 mb-6 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <span className="text-muted-foreground">Sheet 名称</span>
                  <p className="font-medium">{selected.sheetName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">匹配 Item 代码</span>
                  <p className="font-mono text-xs font-medium">{selected.itemPatterns.join(", ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">汇率</span>
                  <p className="font-medium">USD:RMB = 1:{selected.exchangeRate}</p>
                </div>
              </div>
            </div>

            {/* One table per tiered material */}
            {selected.tieredMaterials.map((mat, matIdx) => (
              <div key={matIdx} className="mb-6">
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  {mat.name}
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    {mat.note}
                  </span>
                </h3>
                {mat.spec !== mat.name && (
                  <p className="text-xs text-muted-foreground mb-3 max-w-2xl">{mat.spec}</p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">数量范围</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">单价 (USD/pc)</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">单价 (RMB/pc)</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">vs 最高价</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {TIER_LABELS.map((label, idx) => {
                        const price = mat.tierPrices[idx];
                        const maxPrice = Math.max(...mat.tierPrices.filter((p) => p > 0));
                        const savings = maxPrice > 0 && price > 0 ? ((maxPrice - price) / maxPrice) * 100 : 0;
                        const rmbPrice = price * selected.exchangeRate;
                        const isLower = savings > 0;

                        return (
                          <tr key={idx} className={isLower ? "bg-green-50/50" : "hover:bg-muted/30"}>
                            <td className="px-4 py-2 font-medium">{label} pcs</td>
                            <td className="px-4 py-2 text-right font-mono">
                              {price > 0 ? `$${price.toFixed(3)}` : "-"}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                              {price > 0 ? `¥${rmbPrice.toFixed(5)}` : "-"}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {savings > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                  -{savings.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">基准价</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
