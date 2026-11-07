import { useLocation, useSearchParams } from "react-router";

const emptyParams = new URLSearchParams();

// keep-alive 隐藏单据不能消费当前页面的单号，也不能清除该页面的打开参数。
export function usePageSearchParams(path: string) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  return [pathname === path ? params : emptyParams, setParams] as const;
}
