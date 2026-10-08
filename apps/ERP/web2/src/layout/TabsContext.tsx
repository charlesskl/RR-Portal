import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// 标签页多开:打开的页面生成顶部标签,可关闭;切换时组件保持挂载(隐藏而非卸载),不丢状态。
export interface Tab {
  key: string; // 路由 path
  title: string;
}

interface TabsState {
  tabs: Tab[];
  active: string;
  open: (tab: Tab) => void;
  close: (key: string) => string | null; // 返回关闭后应跳转的 key
  setActive: (key: string) => void;
}

const Ctx = createContext<TabsState | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActiveState] = useState("");

  const open = useCallback((tab: Tab) => {
    setTabs((prev) => (prev.some((t) => t.key === tab.key) ? prev : [...prev, tab]));
    setActiveState(tab.key);
  }, []);

  const close = useCallback(
    (key: string) => {
      let next: string | null = null;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.key === key);
        const rest = prev.filter((t) => t.key !== key);
        if (key === active) {
          next = rest[Math.min(idx, rest.length - 1)]?.key ?? null;
          setActiveState(next ?? "");
        }
        return rest;
      });
      return next;
    },
    [active],
  );

  const setActive = useCallback((key: string) => setActiveState(key), []);

  const value = useMemo(
    () => ({ tabs, active, open, close, setActive }),
    [tabs, active, open, close, setActive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): TabsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTabs must be used within TabsProvider");
  return v;
}
