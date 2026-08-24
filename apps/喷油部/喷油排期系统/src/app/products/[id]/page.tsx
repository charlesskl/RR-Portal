import { dotnetGet } from "@/lib/dotnet";
import { getSession } from "@/lib/session";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ProductEditor } from "./ProductEditor";
import ApprovalBar from "./ApprovalBar";
import { sumUnitCost, sumPaintCost, sumQuotedPrice } from "@/lib/product";

type PartDto = {
  id: number; productId: number; partName: string; partOrder: number;
  unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number; craft: string;
  dailyCapacity: number; productionMode: string; stdMachineCount: number; remark: string | null;
  craftPasses: number; partGroupId: number;
};
type ProductDetailDto = {
  id: number; productNo: string; iterationNo: string; status: string; effectiveDate: string | null;
  remark: string | null; createdBy: string; createdAt: string; lastUpdatedBy: string | null;
  updatedAt: string; parts: PartDto[];
};

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  let product: ProductDetailDto;
  try { product = await dotnetGet<ProductDetailDto>(`/api/products/${params.id}`); }
  catch { notFound(); }

  return <div>
    <Link href="/products" className="text-sky text-sm hover:underline">← 返回产品核价表</Link>
    <div className="flex items-center justify-between mt-2 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-text"><span className="font-mono">{product.productNo}</span></h1>
        <div className="text-sm text-text-secondary mt-1">修改 {new Date(product.updatedAt).toLocaleString("zh-CN")} by {product.lastUpdatedBy ?? product.createdBy}</div>
        <div className="mt-3"><ApprovalBar productId={product.id} status={product.status} role={session.role ?? ""} /></div>
      </div>
      <div className="text-right text-sm">
        <div>总核价 <span className="font-bold">¥{(sumUnitCost(product.parts) + sumPaintCost(product.parts)).toFixed(3)}</span></div>
        <div>总报价 <span className="font-bold">¥{sumQuotedPrice(product.parts).toFixed(3)}</span></div>
      </div>
    </div>
    <ProductEditor productId={product.id} parts={product.parts} />
  </div>;
}
