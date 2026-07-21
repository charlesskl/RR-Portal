// 详情（SSR 取数改走 .NET + 客户端编辑组件）
import { dotnetGet } from "@/lib/dotnet";
import { getSession } from "@/lib/session";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ProductEditor } from "./ProductEditor";
import ApprovalBar from "./ApprovalBar";
import { sumUnitCost, sumPaintCost, sumQuotedPrice } from "@/lib/product";

// .NET 详情返回结构（字段为 .NET 默认 camelCase 序列化）
// items 已按 itemOrder 排序，其内 parts 按 partOrder 排序（后端处理）。
type PartDto = {
  id: number; itemId: number; partName: string; partOrder: number;
  unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number; craft: string;
  dailyCapacity: number; productionMode: string; stdMachineCount: number; remark: string | null; craftPasses: number;
};
type ItemDto = { id: number; productId: number; itemName: string; itemOrder: number; parts: PartDto[] };
type ProductDetailDto = {
  id: number; productNo: string;
  iterationNo: string; status: string; effectiveDate: string | null; remark: string | null;
  createdBy: string; createdAt: string; lastUpdatedBy: string | null; updatedAt: string;
  items: ItemDto[];
};

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // 取数已迁移到 .NET：替代原先的 Prisma findUnique（GET /api/products/{id}）
  // .NET 返回 404 时 dotnetGet 会抛错，捕获后转 notFound() 以保持原有"产品不存在"行为。
  let product: ProductDetailDto;
  try {
    product = await dotnetGet<ProductDetailDto>("/api/products/" + params.id);
  } catch {
    notFound();
  }

  const allParts = product.items.flatMap((i) => i.parts);

  return (
    <div>
      <Link href="/products" className="text-sky text-sm hover:underline">← 返回产品核价表</Link>
      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text"><span className="font-mono">{product.productNo}</span></h1>
          <div className="text-sm text-text-secondary mt-1">修改 {new Date(product.updatedAt).toLocaleString("zh-CN")} by {product.lastUpdatedBy ?? product.createdBy}</div>
          <div className="mt-3"><ApprovalBar productId={product.id} status={product.status} role={session.role ?? ""} /></div>
        </div>
        <div className="text-right text-sm">
          <div>总核价 <span className="font-bold">¥{(sumUnitCost(allParts) + sumPaintCost(allParts)).toFixed(3)}</span> <span className="text-xs text-text-secondary">(核价+油漆)</span></div>
          <div>总报价 <span className="font-bold">¥{sumQuotedPrice(allParts).toFixed(3)}</span></div>
        </div>
      </div>

      <ProductEditor productId={product.id} items={product.items.map((it) => ({
        id: it.id, itemName: it.itemName,
        parts: it.parts.map((p) => ({
          id: p.id, partName: p.partName, craft: p.craft,
          unitCost: p.unitCost, laborPrice: p.laborPrice, paintCost: p.paintCost, quotedPrice: p.quotedPrice,
          dailyCapacity: p.dailyCapacity,
          craftPasses: p.craftPasses,
        })),
      }))} />
    </div>
  );
}
