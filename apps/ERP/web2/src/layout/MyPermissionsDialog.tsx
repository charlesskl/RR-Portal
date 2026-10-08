import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/endpoints";
import type { PermBit } from "@/api/types";
import { getUser } from "@/lib/auth";
import { PickerDialog } from "@/components/doc/PickerDialog";

// 我的权限弹窗:按菜单分组列出当前账号已授予的功能位(未授予位不显示)。
// 与 usePerms 同一 queryKey,命中 5min 缓存,不重复请求。
const BIT_ORDER: PermBit[] = [
  "打开",
  "保存",
  "删除",
  "打印",
  "单价",
  "金额",
  "审核",
  "反审核",
  "功能",
];

export function MyPermissionsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const user = getUser();
  const q = useQuery({
    queryKey: ["user-perms", user],
    queryFn: () => authApi.myPermissions(),
    enabled: open && !!user,
    staleTime: 5 * 60 * 1000,
  });
  const rows = Object.entries(q.data ?? {})
    .map(([menu, bits]) => ({
      menu,
      granted: BIT_ORDER.filter((b) => bits[b]),
    }))
    .filter((r) => r.granted.length > 0);

  return (
    <PickerDialog open={open} onClose={onClose} title="我的权限" width="sm:max-w-[560px]">
      <div className="overflow-y-auto px-6 py-4">
        {q.isLoading && <div className="py-8 text-center text-sm text-[#5f6b7d]">加载中...</div>}
        {q.isError && (
          <div className="py-8 text-center text-sm text-[#dc2626]">权限加载失败,请稍后重试</div>
        )}
        {q.isSuccess && rows.length === 0 && (
          <div className="py-8 text-center text-sm text-[#5f6b7d]">当前账号没有任何菜单权限</div>
        )}
        {q.isSuccess && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/8 text-left text-xs text-[#5f6b7d]">
                <th className="py-2 pr-4 font-medium whitespace-nowrap">菜单</th>
                <th className="py-2 font-medium whitespace-nowrap">已授予功能位</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.menu} className="border-b border-black/5 last:border-0">
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap text-[#1a2330]">
                    {r.menu}
                  </td>
                  <td className="py-2.5">
                    <span className="flex flex-wrap gap-1.5">
                      {r.granted.map((b) => (
                        <span
                          key={b}
                          className="rounded-md bg-[#16a34a]/10 px-2 py-0.5 text-xs text-[#15803d]"
                        >
                          {b}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PickerDialog>
  );
}
