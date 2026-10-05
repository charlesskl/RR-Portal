import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { fileCategory } from "@/lib/file-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DialogState =
  | { type: "newProject"; client?: string }
  | { type: "newFolder"; parentPath: string }
  | { type: "rename"; path: string; name: string }
  | { type: "confirmDelete"; path: string; name: string }
  | { type: "preview"; path: string; name: string; ext: string }
  | { type: "openWith"; path: string; name: string }
  | null;

/* ---------- 新建项目 ---------- */

export function NewProjectDialog({
  open,
  presetClient,
  onClose,
  onCreated,
}: {
  open: boolean;
  presetClient?: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const [clients, setClients] = useState<string[]>([]);
  const [client, setClient] = useState("");
  const [newClient, setNewClient] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setNewClient("");
    setYear(String(new Date().getFullYear()));
    api
      .list("")
      .then((r) => {
        const dirs = r.entries.filter((e) => e.kind === "dir").map((e) => e.name);
        setClients(dirs);
        if (presetClient && dirs.includes(presetClient)) setClient(presetClient);
        else if (presetClient) {
          setClient("__new__");
          setNewClient(presetClient);
        } else setClient((c) => (dirs.includes(c) ? c : (dirs[0] ?? "")));
      })
      .catch(() => setClients([]));
  }, [open, presetClient]);

  const finalClient = client === "__new__" ? newClient.trim() : client;

  const submit = async () => {
    if (!finalClient || !/^\d{4}$/.test(year) || !name.trim()) {
      toast.error("请完整填写：客户、4 位年份、项目名称");
      return;
    }
    setBusy(true);
    try {
      const r = await api.createProject(finalClient, year, name.trim());
      onCreated(r.path);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            将自动创建标准资料目录：工程放产资料 / 模具图（2D排位图、3D模具图）/ 包装印刷最终文件
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>客户</Label>
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger>
                <SelectValue placeholder="选择客户" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">＋ 新客户…</SelectItem>
              </SelectContent>
            </Select>
            {client === "__new__" && (
              <Input
                className="mt-2"
                placeholder="输入新客户名称"
                value={newClient}
                onChange={(e) => setNewClient(e.target.value)}
              />
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>年份</Label>
              <Input value={year} maxLength={4} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>项目名称</Label>
              <Input
                placeholder="例：71172大脑"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          </div>
          {finalClient && name && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
              目标位置：{finalClient} / {year} / {name}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} 创建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 新建文件夹 ---------- */

export function NewFolderDialog({
  state,
  onClose,
  onCreated,
}: {
  state: { type: "newFolder"; parentPath: string } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state) setName("");
  }, [state]);

  const submit = async () => {
    if (!state || !name.trim()) return;
    setBusy(true);
    try {
      const full = state.parentPath ? `${state.parentPath}/${name.trim()}` : name.trim();
      await api.mkdir(full);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建文件夹</DialogTitle>
          <DialogDescription>位置：{state?.parentPath || "资料库根目录"}</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="文件夹名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} 创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 重命名 ---------- */

export function RenameDialog({
  state,
  onClose,
  onRenamed,
}: {
  state: { type: "rename"; path: string; name: string } | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state) setName(state.name);
  }, [state]);

  const submit = async () => {
    if (!state || !name.trim() || name.trim() === state.name) return onClose();
    setBusy(true);
    try {
      await api.rename(state.path, name.trim());
      onRenamed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} 保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 删除确认 ---------- */

export function ConfirmDeleteDialog({
  state,
  onClose,
  onDeleted,
}: {
  state: { type: "confirmDelete"; path: string; name: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await api.remove(state.path);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移入回收站？</AlertDialogTitle>
          <AlertDialogDescription>
            「{state?.name}」将被移入资料库根目录下的回收站，可随时还原。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={submit} disabled={busy} className="bg-red-600 hover:bg-red-700">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} 移入回收站
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------- 文件预览 ---------- */

export function PreviewDialog({
  state,
  onClose,
}: {
  state: { type: "preview"; path: string; name: string; ext: string } | null;
  onClose: () => void;
}) {
  if (!state) return null;
  const cat = fileCategory(state.ext);
  const url = api.fileUrl(state.path);

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{state.name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-slate-50">
          {cat === "image" && (
            <div className="flex h-full items-center justify-center p-4">
              <img src={url} alt={state.name} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {cat === "pdf" && <iframe src={url} title={state.name} className="h-full w-full" />}
          {cat === "video" && <video src={url} controls className="h-full w-full" />}
          {cat === "text" && <iframe src={url} title={state.name} className="h-full w-full bg-white" />}
          {!["image", "pdf", "video", "text"].includes(cat) && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
              <p className="text-sm">此文件类型不支持在线预览</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => window.open(api.fileUrl(state.path, true), "_blank")}>
                  下载后用本机软件打开
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 非表格文件的打开方式（表格文件已直接走网页编辑器） ---------- */

export function OpenWithDialog({
  state,
  onClose,
}: {
  state: { type: "openWith"; path: string; name: string } | null;
  onClose: () => void;
}) {
  if (!state) return null;

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">打开「{state.name}」</DialogTitle>
          <DialogDescription>这类文件需要在电脑上用对应软件打开，请先下载</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 py-2">
          <Button size="sm" onClick={() => window.open(api.fileUrl(state.path, true), "_blank")}>
            下载到本机
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.open(api.fileUrl(state.path), "_blank")}>
            在新标签页打开
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
