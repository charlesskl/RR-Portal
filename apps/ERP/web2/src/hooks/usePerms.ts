import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/endpoints";
import { getUser } from "@/lib/auth";
import type { DocAction } from "@/components/doc/DocToolbar";

// 当前用户的菜单 x 9 功能位权限,TanStack Query 缓存 staleTime 5min。
// 数据源:/auth/me/permissions(直读 userbqrpower,与旧系统 web/src/auth/PermissionContext.tsx 同端点),
// 覆盖 MenuCatalog 未收录的菜单(如 生产排期);admin 端点 /admin/accounts/{user}/perms 只供账号权限管理页用。
// 数据未就位(未登录/加载中/请求失败)时乐观放行,避免按钮闪烁;
// 数据加载完成后严格判断:菜单行缺失或对应位为 false 都视为无权限。
export function usePerms(): {
  can: (menuKey: string, bit: DocAction["perm"]) => boolean;
  loading: boolean;
} {
  const user = getUser();
  const q = useQuery({
    queryKey: ["user-perms", user],
    queryFn: () => authApi.myPermissions(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  const map = q.data;
  const can = (menuKey: string, bit: DocAction["perm"]): boolean => {
    if (!bit) return true; // 未声明权限位的动作不受控
    if (!map) return true; // 权限未加载完成,先放行
    return !!map[menuKey]?.[bit];
  };
  return { can, loading: q.isLoading };
}
