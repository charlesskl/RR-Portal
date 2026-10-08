import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/setup";
import App from "../App";

describe("应用外壳", () => {
  it("根路由渲染宫格首页且没有旧 POS 入口", async () => {
    localStorage.setItem("web2.token", "fake");
    renderWithProviders(<App />);
    // 并行跑全套测试时 worker 互相抢占 CPU,首页首渲可能超过 1s 默认超时
    expect(await screen.findByText("全部", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("工程部")).toBeInTheDocument();
  });
});
