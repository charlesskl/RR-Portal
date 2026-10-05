import { useEffect, useState } from "react";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Overview, View } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  onNavigate: (v: View) => void;
  refreshKey: number;
}

const CLIENT_COLORS = [
  "from-blue-500 to-blue-600",
  "from-emerald-500 to-emerald-600",
  "from-violet-500 to-violet-600",
  "from-amber-500 to-amber-600",
  "from-rose-500 to-rose-600",
  "from-cyan-500 to-cyan-600",
  "from-indigo-500 to-indigo-600",
  "from-orange-500 to-orange-600",
];

/** 系统首页：客户列表 */
export default function ClientsView({ onNavigate, refreshKey }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api
      .overview()
      .then(setData)
      .catch((e) => setError(e.message));
  }, [refreshKey]);

  if (error) {
    return <div className="p-8 text-center text-sm text-red-600">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> 正在读取客户列表…
      </div>
    );
  }

  const clients = data.clients.filter((c) => c.years > 0 || c.projects > 0);
  const others = data.clients.filter((c) => c.years === 0 && c.projects === 0);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold">选择客户，进入做资料</h2>
        <p className="mt-1 text-sm text-slate-500">
          共 {data.totals.clients} 个客户 · {data.totals.projects} 个项目
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {clients.map((c, i) => (
          <Card
            key={c.name}
            className="group cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg"
            onClick={() => onNavigate({ type: "client", client: c.name })}
          >
            <div
              className={cn(
                "flex h-20 items-center justify-center bg-gradient-to-br text-white",
                CLIENT_COLORS[i % CLIENT_COLORS.length],
              )}
            >
              <Building2 className="h-8 w-8 opacity-90" />
            </div>
            <CardContent className="flex items-center justify-between p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.years} 个年度 · {c.projects} 个项目
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-blue-500" />
            </CardContent>
          </Card>
        ))}
      </div>

      {others.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-slate-500">其他目录</h3>
          <div className="flex flex-wrap gap-2">
            {others.map((c) => (
              <button
                key={c.name}
                className="rounded-full border bg-white px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700"
                onClick={() => onNavigate({ type: "explorer", path: c.name })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
