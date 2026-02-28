"use client";

import { useState } from "react";
import { Package, Upload, FileText, Calculator, RotateCcw, Receipt } from "lucide-react";
import ImportSchedule from "@/components/ImportSchedule";
import POSelector from "@/components/POSelector";
import PricingTable from "@/components/PricingTable";
import InvoiceHistory from "@/components/InvoiceHistory";
import { resetData } from "@/lib/store";

type Tab = "import" | "calculate" | "pricing" | "history";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("import");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleReset = () => {
    if (confirm("确定要重置所有数据？此操作不可撤销。")) {
      resetData();
      refresh();
    }
  };

  const goToCalculate = () => {
    setActiveTab("calculate");
    refresh();
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "import", label: "导入排期表", icon: <Upload size={18} /> },
    { id: "calculate", label: "PO 差价计算", icon: <Calculator size={18} /> },
    { id: "pricing", label: "阶梯价格表", icon: <FileText size={18} /> },
    { id: "history", label: "Invoice 记录", icon: <Receipt size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header data-no-print className="bg-card border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Package size={18} className="text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">
                  包装物料差价系统
                </h1>
                <p className="text-xs text-muted-foreground">
                  9565 松鼠 | Pets Alive Squirrel
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
            >
              <RotateCcw size={14} />
              重置数据
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav data-no-print className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); refresh(); }}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === "import" && (
          <ImportSchedule key={refreshKey} onImported={goToCalculate} />
        )}
        {activeTab === "calculate" && (
          <POSelector key={refreshKey} onInvoiceSaved={refresh} />
        )}
        {activeTab === "pricing" && <PricingTable />}
        {activeTab === "history" && <InvoiceHistory key={refreshKey} />}
      </main>
    </div>
  );
}
