// 删除/停用确认弹窗(不透明白底;原为 7 个单据页 + 排期批次弹窗的内联拷贝,Batch 0E 收敛为单源)。
// 行为约定:确认按钮红色文字;取消/确认都由调用方决定后续动作(onConfirm 内自行关窗)。
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "确认删除",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-black/10 bg-white text-[#1a2330] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description != null && (
            <DialogDescription className="text-[#5f6b7d]">{description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <button type="button" className="f-btn h-10 px-4" onClick={onClose}>
            取消
          </button>
          <button type="button" className="f-btn h-10 px-4 text-[#dc2626]" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
