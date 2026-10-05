import { useEffect, useState } from "react";
import { FolderOpen, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatSize, formatTime } from "@/lib/file-utils";
import type { TrashItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function TrashView({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setItems(null);
    api
      .trash()
      .then((r) => setItems(r.items))
      .catch((e) => {
        toast.error(e.message);
        setItems([]);
      });
  };

  useEffect(load, [refreshKey]);

  const restore = async (item: TrashItem) => {
    try {
      const r = await api.restore(item.trashName);
      toast.success(`已还原到：${r.restoredTo}`);
      load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const purge = async () => {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      await api.purge(purgeTarget.trashName);
      toast.success("已彻底删除");
      setPurgeTarget(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2.5">
        <h2 className="text-sm font-semibold">回收站（删除的内容会先移到这里，可还原）</h2>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {items === null ? (
          <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> 加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="p-16 text-center text-sm text-slate-400">回收站是空的</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[35%]">名称</TableHead>
                <TableHead>原位置</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-40">删除时间</TableHead>
                <TableHead className="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.trashName}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {it.kind === "dir" && <FolderOpen className="h-4 w-4 text-amber-500" />}
                      <span className="truncate font-medium">{it.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-0 truncate text-xs text-slate-400" title={it.originalPath}>
                    {it.originalPath || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">{formatSize(it.size)}</TableCell>
                  <TableCell className="text-slate-500">{formatTime(it.deletedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="mr-2" onClick={() => restore(it)}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> 还原
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setPurgeTarget(it)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AlertDialog open={!!purgeTarget} onOpenChange={(o) => !o && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>彻底删除？</AlertDialogTitle>
            <AlertDialogDescription>
              「{purgeTarget?.name}」将被永久删除，无法恢复。此操作不可撤销！
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={purge} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} 永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
