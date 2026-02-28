"use client";

import { useEffect, useState } from "react";
import { Receipt, Eye } from "lucide-react";
import { SavedInvoice } from "@/lib/data";
import { getSavedInvoices } from "@/lib/store";
import InvoiceView from "./InvoiceView";

export default function InvoiceHistory() {
  const [invoices, setInvoices] = useState<SavedInvoice[]>([]);
  const [viewing, setViewing] = useState<SavedInvoice | null>(null);

  useEffect(() => {
    setInvoices(getSavedInvoices());
  }, []);

  if (viewing) {
    return (
      <InvoiceView
        poNumber={viewing.poNumber}
        customerPO={viewing.customerPO}
        customer={viewing.customer}
        lineItems={viewing.lineItems}
        totalCharge={viewing.totalCharge}
        onBack={() => setViewing(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Invoice 记录</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            已生成的差价 Invoice 历史
          </p>
        </div>

        {invoices.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt size={32} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">暂无 Invoice 记录</p>
            <p className="text-xs text-muted-foreground mt-1">
              到「PO 差价计算」页面选择 PO 并生成 Invoice
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {invoices
              .slice()
              .reverse()
              .map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-medium">{inv.poNumber}</span>
                      <span className="text-xs text-muted-foreground">{inv.date}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {inv.lineItems.length} 项物料 | MA 调整:{" "}
                      <span className="font-mono font-medium text-foreground">
                        {inv.totalCharge < 0 ? "-" : ""}${Math.abs(inv.totalCharge).toFixed(2)} USD
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => setViewing(inv)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    <Eye size={14} />
                    查看

                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
