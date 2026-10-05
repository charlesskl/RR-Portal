import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { View, WalkItem } from "@/types";
import type { DialogState } from "@/sections/Dialogs";
import { FileResultList } from "@/sections/SearchView";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function RecentView({
  onNavigate,
  onOpenDialog,
  onOpenEditor,
}: {
  onNavigate: (v: View) => void;
  onOpenDialog: (d: DialogState) => void;
  onOpenEditor: (path: string, name: string) => void;
}) {
  const [items, setItems] = useState<WalkItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .recent(100)
      .then((r) => setItems(r.results))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2.5">
        <h2 className="text-sm font-semibold">最近更新的 100 个文件</h2>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileResultList
          items={items}
          loading={loading}
          emptyText="暂无文件"
          onNavigate={onNavigate}
          onOpenDialog={onOpenDialog}
          onOpenEditor={onOpenEditor}
        />
      </div>
    </div>
  );
}
