import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

// shadcn-ui 标准助手：合并 Tailwind className，自动去重冲突类
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
