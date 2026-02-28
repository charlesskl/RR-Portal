"use client";

import { useRef } from "react";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { InvoiceLineItem } from "@/lib/data";

interface InvoiceViewProps {
  poNumber: string;
  customerPO?: string;
  customer?: string;
  lineItems: InvoiceLineItem[];
  totalCharge: number;
  onBack: () => void;
}

// Group line items by itemNumber for the invoice layout
interface ItemGroup {
  itemNumber: string;
  productName: string;
  poQuantity: number;
  materials: InvoiceLineItem[];
}

export default function InvoiceView({
  poNumber,
  customerPO,
  customer,
  lineItems,
  totalCharge,
  onBack,
}: InvoiceViewProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const invoiceNo = `ZB${Date.now().toString(36).toUpperCase().slice(-5)}`;

  // Group line items by item
  const itemGroups: ItemGroup[] = [];
  for (const item of lineItems) {
    let group = itemGroups.find((g) => g.itemNumber === item.itemNumber);
    if (!group) {
      group = {
        itemNumber: item.itemNumber,
        productName: item.productName || item.itemNumber,
        poQuantity: item.poQuantity,
        materials: [],
      };
      itemGroups.push(group);
    }
    group.materials.push(item);
  }

  const handlePrint = () => window.print();

  const handleExportCSV = () => {
    const headers = [
      "Invoice No",
      "Date",
      "ZURU PO#",
      "No.",
      "SKU No.",
      "Spec#",
      "Description",
      "Quantity",
      "Unit Price Adj (USD)",
      "Total Price (USD)",
    ];
    const rows: string[][] = [];

    itemGroups.forEach((group, gIdx) => {
      // Product row
      rows.push([
        invoiceNo,
        today,
        poNumber,
        String(gIdx + 1),
        group.itemNumber.split("-")[0],
        group.itemNumber,
        group.productName,
        String(group.poQuantity),
        "",
        "",
      ]);
      // MA adjustment rows
      for (const mat of group.materials) {
        rows.push([
          "",
          "",
          "",
          "",
          "",
          "",
          `MA#${mat.maNumber} - ${mat.quotationMaterial || mat.materialName} MA(${mat.poTierLabel}) - MA(${mat.maTierLabel})`,
          String(mat.materialQty),
          mat.priceDiff.toFixed(3),
          mat.chargeAmount.toFixed(2),
        ]);
      }
      // Final price row
      const groupTotal = group.materials.reduce((s, m) => s + m.chargeAmount, 0);
      rows.push([
        "",
        "",
        "",
        "",
        "",
        "",
        "Final Price Adjustment",
        String(group.poQuantity),
        "",
        groupTotal.toFixed(2),
      ]);
    });

    // Total
    rows.push(["", "", "", "", "", "", "", "", "TOTAL", totalCharge.toFixed(2)]);

    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Invoice_${poNumber}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div data-no-print className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} /> 返回计算
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80"
          >
            <Download size={14} /> 导出 CSV
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Printer size={14} /> 打印
          </button>
        </div>
      </div>

      <div
        ref={invoiceRef}
        className="bg-white rounded-xl border border-border p-8 print:border-none print:p-0 text-black"
      >
        {/* Company Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold">
            Royal Regent Products (Asia) Limited
          </h1>
          <p className="text-xs text-gray-600 mt-0.5">
            Unit 07-08, 12/F, Greenfield Tower, Concordia Plaza, No.1 Science
            Museum Road, Tsim Sha Tsui, Kowloon, Hong Kong
          </p>
          <p className="text-xs text-gray-600">TEL: 852-24250720</p>
          <p className="text-xs text-gray-600">
            E-MAIL: info@royalregenthk.com
          </p>
        </div>

        {/* Title */}
        <div className="text-center mb-6">
          <h2 className="text-lg font-bold tracking-wider">
            COMMERCIAL INVOICE
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Packaging Material MA Tier Price Adjustment
          </p>
        </div>

        {/* Sold To / Invoice Details */}
        <div className="grid grid-cols-2 gap-6 mb-6 text-sm border border-gray-300">
          {/* Left: Sold To */}
          <div className="p-4 border-r border-gray-300">
            <p className="text-xs text-gray-500 font-medium mb-1">Sold to:</p>
            <p className="font-semibold">ZURU INC</p>
            <p className="text-xs text-gray-600 mt-1">
              Flat/Rm 01-03, 12/F, Energy Plaza,
            </p>
            <p className="text-xs text-gray-600">
              92 Granville Road, Tsim Sha Tsui East,
            </p>
            <p className="text-xs text-gray-600">Kowloon, Hong Kong</p>
            {customer && (
              <p className="text-xs text-gray-600 mt-2">
                Ultimate Consignee: {customer}
              </p>
            )}
          </div>

          {/* Right: Invoice Info */}
          <div className="p-4 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Inv No.:</span>
              <span className="font-mono font-medium">{invoiceNo}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Date:</span>
              <span>{today}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">ZURU PO#:</span>
              <span className="font-mono">{poNumber}</span>
            </div>
            {customerPO && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Ultimate Consignee Po#:</span>
                <span className="font-mono text-[11px]">{customerPO}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Country of Origin:</span>
              <span>China</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Inco Term:</span>
              <span>EXW+Exportation</span>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table className="w-full text-sm mb-6 border-collapse">
          <thead>
            <tr className="border-t-2 border-b-2 border-black">
              <th className="text-center py-2 px-2 font-semibold w-10">No.</th>
              <th className="text-left py-2 px-2 font-semibold w-24">
                SKU No.
              </th>
              <th className="text-left py-2 px-2 font-semibold w-28">Spec#</th>
              <th className="text-left py-2 px-2 font-semibold">
                Description
              </th>
              <th className="text-right py-2 px-2 font-semibold w-20">
                Quantity
              </th>
              <th className="text-right py-2 px-2 font-semibold w-28">
                Unit Price Adj
              </th>
              <th className="text-right py-2 px-2 font-semibold w-28">
                Total Price (USD)
              </th>
            </tr>
          </thead>
          <tbody>
            {itemGroups.map((group, gIdx) => {
              const groupTotal = group.materials.reduce(
                (s, m) => s + m.chargeAmount,
                0
              );
              const perPcAdj =
                group.poQuantity > 0 ? groupTotal / group.poQuantity : 0;

              return (
                <tr key={gIdx} className="border-b border-gray-200">
                  <td colSpan={7} className="p-0">
                    {/* Product row */}
                    <div className="flex items-baseline border-b border-gray-100">
                      <div className="w-10 text-center py-2 px-2 text-sm">
                        {gIdx + 1}
                      </div>
                      <div className="w-24 py-2 px-2 font-mono text-xs font-medium">
                        {group.itemNumber.split("-")[0]}
                      </div>
                      <div className="w-28 py-2 px-2 font-mono text-xs">
                        {group.itemNumber}
                      </div>
                      <div className="flex-1 py-2 px-2 text-xs">
                        {group.productName}
                      </div>
                      <div className="w-20 py-2 px-2 text-right font-mono">
                        {group.poQuantity.toLocaleString()}
                      </div>
                      <div className="w-28 py-2 px-2 text-right font-mono text-gray-400">
                        -
                      </div>
                      <div className="w-28 py-2 px-2 text-right font-mono text-gray-400">
                        -
                      </div>
                    </div>

                    {/* MA adjustment rows */}
                    {group.materials.map((mat, mIdx) => (
                      <div
                        key={mIdx}
                        className="flex items-baseline bg-gray-50/50 border-b border-gray-100"
                      >
                        <div className="w-10 py-1.5 px-2" />
                        <div className="w-24 py-1.5 px-2" />
                        <div className="w-28 py-1.5 px-2" />
                        <div className="flex-1 py-1.5 px-2 text-xs text-gray-700">
                          <span className="font-mono text-[11px]">
                            MA#{mat.maNumber}
                          </span>
                          <span className="mx-1">-</span>
                          <span>
                            {mat.quotationMaterial || mat.materialName}
                          </span>
                          <span className="mx-1 text-gray-400">
                            MA({mat.poTierLabel}) - MA({mat.maTierLabel})
                          </span>
                        </div>
                        <div className="w-20 py-1.5 px-2 text-right font-mono text-xs text-gray-600">
                          {mat.materialQty.toLocaleString()}
                        </div>
                        <div className="w-28 py-1.5 px-2 text-right font-mono text-xs">
                          {mat.priceDiff !== 0 ? (
                            <span
                              className={
                                mat.priceDiff < 0
                                  ? "text-red-600"
                                  : "text-green-600"
                              }
                            >
                              {mat.priceDiff < 0 ? "-" : "+"}$
                              {Math.abs(mat.priceDiff).toFixed(5)}
                            </span>
                          ) : (
                            <span className="text-gray-400">$0/pc</span>
                          )}
                        </div>
                        <div className="w-28 py-1.5 px-2 text-right font-mono text-xs">
                          {mat.chargeAmount !== 0 ? (
                            <span
                              className={
                                mat.chargeAmount < 0
                                  ? "text-red-600"
                                  : "text-green-600"
                              }
                            >
                              {mat.chargeAmount < 0 ? "-" : ""}$
                              {Math.abs(mat.chargeAmount).toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-400">$0.00</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Final Price row */}
                    <div className="flex items-baseline bg-blue-50/50">
                      <div className="w-10 py-1.5 px-2" />
                      <div className="w-24 py-1.5 px-2" />
                      <div className="w-28 py-1.5 px-2" />
                      <div className="flex-1 py-1.5 px-2 text-xs font-semibold text-gray-800">
                        Final Price Adjustment
                      </div>
                      <div className="w-20 py-1.5 px-2 text-right font-mono text-xs font-medium">
                        {group.poQuantity.toLocaleString()}
                      </div>
                      <div className="w-28 py-1.5 px-2 text-right font-mono text-xs font-medium">
                        {perPcAdj !== 0 ? (
                          <span
                            className={
                              perPcAdj < 0 ? "text-red-700" : "text-green-700"
                            }
                          >
                            {perPcAdj < 0 ? "-" : "+"}$
                            {Math.abs(perPcAdj).toFixed(5)}
                          </span>
                        ) : (
                          "$0.00000"
                        )}
                      </div>
                      <div className="w-28 py-1.5 px-2 text-right font-mono text-xs font-bold">
                        {groupTotal !== 0 ? (
                          <span
                            className={
                              groupTotal < 0
                                ? "text-red-700"
                                : "text-green-700"
                            }
                          >
                            {groupTotal < 0 ? "-" : ""}$
                            {Math.abs(groupTotal).toFixed(2)}
                          </span>
                        ) : (
                          "$0.00"
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Total Amount */}
        <div className="border-t-2 border-black pt-4 flex justify-end mb-8">
          <div className="text-right">
            <p className="text-xs text-gray-500 font-medium">
              TOTAL AMOUNT (USD)
            </p>
            <p className="text-2xl font-bold mt-1">
              {totalCharge < 0 ? "-" : ""}${Math.abs(totalCharge).toFixed(2)}{" "}
              <span className="text-sm font-normal text-gray-500">USD</span>
            </p>
          </div>
        </div>

        {/* Payment / Bank Details */}
        <div className="border-t border-gray-300 pt-4 text-xs text-gray-600 space-y-1">
          <p className="font-semibold text-gray-800 mb-2">
            Payable in US dollars
          </p>
          <div className="grid grid-cols-[120px_1fr] gap-y-1">
            <span className="text-gray-500">Bank Name:</span>
            <span>
              Industrial and Commercial Bank Of China (Asia) Limited
            </span>
            <span className="text-gray-500">Branch:</span>
            <span>Quarry Bay</span>
            <span className="text-gray-500">Address:</span>
            <span>
              33/F., ICBC Tower, 3 Garden Road, Central, Hong Kong
            </span>
            <span className="text-gray-500">Account Name:</span>
            <span>Royal Regent Products(Asia)Limited</span>
            <span className="text-gray-500">Account#:</span>
            <span className="font-mono">USD S/A 706530001608</span>
            <span className="text-gray-500">SWIFT Code:</span>
            <span className="font-mono">UBHKHKHH</span>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-gray-200 text-[10px] text-gray-400">
          <p>
            This invoice is generated by the Packaging Cost System for PO #
            {poNumber}.
          </p>
          <p>
            Tier prices are sourced from the imported quotation file. MA price
            adjustment = MA tier price - PO tier price.
          </p>
        </div>
      </div>
    </div>
  );
}
