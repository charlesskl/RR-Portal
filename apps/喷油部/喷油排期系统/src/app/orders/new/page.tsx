// 新建订单（server 载入产品列表 → 交给 client OrderEditor）—— spec §3.2
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import OrderEditor from "./OrderEditor";

// .NET GET /api/products 列表项（本页只用 id/productNo，并按 status 过滤作废）
type ProductListItemDto = {
  id: number;
  productNo: string;
  status: string;
};

export default async function NewOrderPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  // 只列「已生效(active)」的产品供下单 —— 待审核(draft)/作废(archived) 都不能选
  // （审核功能：保证订单用的是审核通过、生效的核价）
  const all = await dotnetGet<ProductListItemDto[]>("/api/products");
  const products = all
    .filter((p) => p.status === "active")
    .map((p) => ({ id: p.id, productNo: p.productNo }));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-text mb-6">📋 新建订单</h1>
      <OrderEditor products={products} />
    </div>
  );
}
