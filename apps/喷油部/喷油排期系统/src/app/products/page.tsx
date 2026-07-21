// 第 1 层 · 产品核价表主表（以款号为主）—— SSR 取数走 .NET（GET /api/products）
import Link from "next/link";
import { dotnetGet } from "@/lib/dotnet";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { ProductsTable, type ProductRow } from "./ProductsTable";
import { ImportButton } from "./ImportDialog";

// .NET 列表返回结构（字段为 .NET 默认 camelCase 序列化）
type ProductListDto = ProductRow;

export default async function ProductsPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const products = await dotnetGet<ProductListDto[]>("/api/products");

  return (
    <div className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">📇 产品核价表</h1>
        <div className="flex items-center gap-3">
          <ImportButton />
          <Link href="/products/new" className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)]">+ 新建产品</Link>
        </div>
      </div>
      <ProductsTable products={products} />
    </div>
  );
}
