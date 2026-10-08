// 图片备注面板(Batch 0D 移植;照抄老系统 web/src/components/ImageNotesPanel.tsx):
// 上传(可带备注)+预览+删除。生产通知单传 模块=生产单/单号=生产单号;BOM 页传 模块=BOM/单号=款号。
// 权限与后端 ImageNoteController 一致:菜单「打开」可读,「保存」可上传/删除(canEdit 由调用方按「保存」位传入)。
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, UploadSimple } from "@phosphor-icons/react";
import { imageNoteApi, imageNoteUrl } from "@/api/endpoints";
import type { ImageNote } from "@/api/types";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.bmp";
const MAX_MB = 10;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

export function ImageNotesPanel({
  模块,
  单号,
  canEdit,
  emptyHint = "请先打开单据",
}: {
  模块: string;
  单号: string;
  canEdit: boolean;
  emptyHint?: string;
}) {
  const [备注, set备注] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImageNote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImageNote | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const q = useQuery({
    queryKey: ["image-notes", 模块, 单号],
    queryFn: () => imageNoteApi.list(模块, 单号),
    enabled: !!单号,
  });
  const rows = q.data ?? [];

  const upload = async (f: File) => {
    if (f.size > MAX_MB * 1024 * 1024) {
      setToast({ text: `图片不能超过 ${MAX_MB}MB`, tone: "err" });
      return;
    }
    setUploading(true);
    try {
      await imageNoteApi.upload(模块, 单号, f, 备注 || undefined);
      set备注("");
      setToast({ text: "已上传", tone: "ok" });
      await q.refetch();
    } catch (e) {
      setToast({ text: errMsg(e) || "上传失败", tone: "err" });
    } finally {
      setUploading(false);
      // 允许连续选同一文件
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (n: ImageNote) => {
    try {
      await imageNoteApi.remove(n.ID);
      setToast({ text: "已删除", tone: "ok" });
      await q.refetch();
    } catch (e) {
      setToast({ text: errMsg(e) || "删除失败", tone: "err" });
    }
  };

  if (!单号) {
    return (
      <div className="f-panel">
        <DocEmpty
          icon={<ImageIcon className="h-5 w-5" />}
          title={emptyHint}
          description="打开单据后可上传与查看图片备注"
        />
      </div>
    );
  }

  return (
    <div className="f-panel p-4">
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <input
            className="h-10 w-72 rounded-md border border-black/10 bg-black/[0.04] px-3 text-[15px] text-[#1a2330] placeholder:text-disabled"
            value={备注}
            maxLength={200}
            placeholder="备注(可选,跟随下一张上传的图片)"
            onChange={(e) => set备注(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            aria-label="选择图片"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            className="f-btn h-10 px-4"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <UploadSimple className="h-4 w-4" />
            {uploading ? "上传中..." : "上传图片"}
          </button>
          <span className="text-sm text-disabled">
            支持 jpg/png/gif/webp/bmp,不超过 {MAX_MB}MB
          </span>
        </div>
      )}
      {q.isError ? (
        <p className="py-4 text-center text-sm text-[#dc2626]">
          加载图片备注失败:{errMsg(q.error)}
          <button type="button" className="ml-2 underline" onClick={() => q.refetch()}>
            重试
          </button>
        </p>
      ) : rows.length === 0 && !q.isLoading ? (
        <DocEmpty
          icon={<ImageIcon className="h-5 w-5" />}
          title="暂无图片备注"
          description={canEdit ? "上传图片后可在此统一查看" : undefined}
        />
      ) : (
        <div className="flex flex-wrap gap-4">
          {rows.map((n) => (
            <div key={n.ID} className="w-36 text-center">
              <button
                type="button"
                className="block h-36 w-36 overflow-hidden rounded-lg border border-black/10 bg-black/[0.03] transition-shadow hover:shadow-md"
                onClick={() => setPreview(n)}
              >
                <img
                  src={imageNoteUrl(n)}
                  alt={n.文件名 ?? ""}
                  className="h-full w-full object-cover"
                />
              </button>
              <div className="mt-1 text-xs break-all text-[#3d4a5c]">
                {n.备注 || n.文件名 || ""}
              </div>
              <div className="text-xs text-disabled">
                {n.上传人} {n.上传时间 ? n.上传时间.slice(0, 10) : ""}
              </div>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`删除图片 ${n.备注 || n.文件名 || n.ID}`}
                  className="mt-0.5 text-xs font-medium text-[#dc2626] hover:underline"
                  onClick={() => setDeleteTarget(n)}
                >
                  删除
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 大图预览 */}
      <Dialog open={preview != null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.备注 || preview?.文件名 || "图片预览"}</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              {preview?.文件名 ?? "图片大图预览"},点击外部或按 Esc 关闭
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <img
              src={imageNoteUrl(preview)}
              alt={preview.文件名 ?? ""}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="确认删除该图片?"
        description={deleteTarget?.备注 || deleteTarget?.文件名 || undefined}
        onConfirm={() => {
          const t = deleteTarget;
          setDeleteTarget(null);
          if (t) void remove(t);
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
