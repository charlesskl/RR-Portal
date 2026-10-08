import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";

// 机器高负载(并行任务多)时 waitFor 默认 1s 超时易抖动,放宽到 5s
configure({ asyncUtilTimeout: 5000 });

// 测试桩适配:/auth/me/permissions 的响应是 菜单->功能位 map(旧系统 PermMap 形状),
// 各测试的 perms 字面量仍是 MenuPermRow[] 数组,桩里统一转成 map
export function permRowsToMap(rows: unknown): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  if (!Array.isArray(rows)) return map;
  for (const r of rows as Record<string, unknown>[]) {
    const { 菜单, 组: _组, ...bits } = r;
    if (typeof 菜单 === "string") map[菜单] = bits;
  }
  return map;
}

export function renderWithProviders(ui: ReactElement, route = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <div data-theme="future">{ui}</div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
