// 错误态:红色标题 + 错误消息 + 可选重试按钮
export function DocError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-sm font-medium text-[#dc2626]">加载失败</div>
      <p className="max-w-xs text-sm text-[#5f6b7d]">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="f-btn mt-3 h-10 text-sm">
          重试
        </button>
      )}
    </div>
  );
}
