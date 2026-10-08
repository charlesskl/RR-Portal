import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useTabs, type Tab } from "@/layout/TabsContext";

// 单据页标签操作:包装 TabsContext + 路由跳转。
// openTab 注册(或复用)标签并跳转;closeTab 仅当关闭的是激活标签时才导航
// (跳到相邻标签,无标签则回首页),关闭后台标签只移除、停留在当前路由。
export function useDocTabs(): {
  tabs: Tab[];
  openTab: (path: string, title: string) => void;
  closeTab: (path: string) => void;
} {
  const { tabs, active, open, close } = useTabs();
  const navigate = useNavigate();

  const openTab = useCallback(
    (path: string, title: string) => {
      open({ key: path, title });
      navigate(path);
    },
    [open, navigate],
  );

  // close 只对「关闭的是激活标签」返回相邻 key,关闭后台标签返回 null;
  // 只有关闭激活标签才需要导航,否则停留在当前路由
  const closeTab = useCallback(
    (path: string) => {
      const wasActive = active === path;
      const next = close(path);
      if (wasActive) navigate(next ?? "/");
    },
    [active, close, navigate],
  );

  return { tabs, openTab, closeTab };
}
