// 退出软件(/logout;老系统 web/src/pages/system/LogoutPage.tsx 重写):
// 先调后端 /auth/logout 立即置离线,再清本地令牌与用户后整页回登录页(整页跳转顺带清空内存中的权限缓存)。
// 无权限菜单(MenuCatalog 未收录,老系统 menuTree 该项也无权限键)。
import { useEffect } from "react";
import { authApi } from "@/api/endpoints";
import { logout } from "@/lib/auth";

export default function LogoutPage() {
  useEffect(() => {
    void authApi.logout().catch(() => {});
    logout();
    // 整页跳转:不走 react-router 内部导航,确保 keep-alive 标签页与查询缓存一并清空
    window.location.assign(`${import.meta.env.BASE_URL}login`);
  }, []);
  return (
    <div className="flex h-full min-h-60 items-center justify-center">
      <span className="text-sm text-[#5f6b7d]">正在退出...</span>
    </div>
  );
}
