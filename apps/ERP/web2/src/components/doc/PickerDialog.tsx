// 通用选择弹窗骨架(弹窗四律:不透明白底 / max-h 限视口 / sticky 表头 / 底部固定)。
// 原为 6 处逐字拷贝(PlasticIssue/MaterialIssue/PurchaseOrder/PurchaseReceipt/
// PlasticReceipt/AssemblyPurchaseHeader),Batch 0E 收敛为单源,行为不变。
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function PickerDialog({
  open,
  onClose,
  title,
  width,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden border-black/10 bg-[#ffffff] p-0 text-[#1a2330]",
          width ?? "sm:max-w-[720px]",
        )}
      >
        <div className="shrink-0 border-b border-black/8 px-6 pt-5 pb-4">
          <DialogHeader>
            <DialogTitle className="text-lg text-[#1a2330]">{title}</DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </DialogHeader>
        </div>
        {/* 滚动口自身不留 padding:padding 会在吸顶表头/冻结列上方形成透明镂空带(滚过的行透出);
            间距改由内层 div 承担,滚动后自然让位,表头贴着滚动口边缘 */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="px-6 py-4">{children}</div>
        </div>
        {footer != null && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/8 px-6 py-3">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// 弹窗内表格 sticky 表头四律:sticky + 不透明白底 + z-10 + border-b
export const pickerThCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";
