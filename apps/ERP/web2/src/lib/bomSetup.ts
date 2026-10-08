// BOM物料设置页共享纯函数(页面与测试共用,独立文件避免 only-export-components)。

// 关闭落点:有 return 参数回来源页,否则后退一页(照抄老系统 buildCloseTarget)
export function buildCloseTarget(returnTo: string): string;
export function buildCloseTarget(returnTo: null): number;
export function buildCloseTarget(returnTo: string | null): string | number {
  return returnTo || -1;
}
