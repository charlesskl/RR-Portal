import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { renderWithProviders } from "../test/setup";
import { TabsProvider } from "@/layout/TabsContext";
import { TabBar } from "@/layout/MainLayout";
import { useDocTabs } from "@/hooks/useDocTabs";

afterEach(cleanup);

// 探针组件:暴露 openTab/closeTab 操作与当前路由、标签列表
function Probe() {
  const { tabs, openTab, closeTab } = useDocTabs();
  const loc = useLocation();
  return (
    <div>
      <div data-testid="loc">{loc.pathname}</div>
      <div data-testid="tabs">{tabs.map((t) => t.key).join(",")}</div>
      <button onClick={() => openTab("/a", "页面A")}>open-a</button>
      <button onClick={() => openTab("/b", "页面B")}>open-b</button>
      <button onClick={() => closeTab("/a")}>close-a</button>
      <button onClick={() => closeTab("/b")}>close-b</button>
    </div>
  );
}

function renderProbe() {
  return renderWithProviders(
    <TabsProvider>
      <Probe />
    </TabsProvider>,
    "/",
  );
}

describe("useDocTabs.closeTab", () => {
  it("关闭激活标签:导航到相邻标签", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByText("open-a"));
    await user.click(screen.getByText("open-b")); // 激活 /b
    expect(screen.getByTestId("loc")).toHaveTextContent("/b");

    await user.click(screen.getByText("close-b"));
    expect(screen.getByTestId("tabs")).toHaveTextContent("/a");
    expect(screen.getByTestId("loc")).toHaveTextContent("/a");
  });

  it("关闭非激活标签:不导航,停留在当前路由", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByText("open-a"));
    await user.click(screen.getByText("open-b")); // 激活 /b,/a 在后台
    expect(screen.getByTestId("loc")).toHaveTextContent("/b");

    await user.click(screen.getByText("close-a"));
    expect(screen.getByTestId("tabs")).toHaveTextContent("/b");
    // 关闭后台标签不应把用户拽走
    expect(screen.getByTestId("loc")).toHaveTextContent("/b");
  });
});

// 真实 UI 路径:MainLayout 的 TabBar 关闭按钮
function TabHost() {
  const { openTab } = useDocTabs();
  const loc = useLocation();
  return (
    <>
      <div data-testid="loc">{loc.pathname}</div>
      <button onClick={() => openTab("/production", "生产通知单")}>open-p</button>
      <button onClick={() => openTab("/inventory", "物料库存查询")}>open-i</button>
      <TabBar />
    </>
  );
}

function renderTabHost() {
  return renderWithProviders(
    <TabsProvider>
      <TabHost />
    </TabsProvider>,
    "/",
  );
}

describe("MainLayout TabBar 关闭路径", () => {
  it("关闭后台标签:路由不跳首页", async () => {
    const user = userEvent.setup();
    renderTabHost();
    await user.click(screen.getByText("open-p"));
    await user.click(screen.getByText("open-i")); // 激活 物料库存查询
    expect(screen.getByTestId("loc")).toHaveTextContent("/inventory");

    await user.click(screen.getByLabelText("关闭 生产通知单"));
    // 标签已移除,但路由不应被拽走
    expect(screen.queryByLabelText("关闭 生产通知单")).toBeNull();
    expect(screen.getByTestId("loc")).toHaveTextContent("/inventory");
  });

  it("关闭激活标签:跳到相邻标签", async () => {
    const user = userEvent.setup();
    renderTabHost();
    await user.click(screen.getByText("open-p"));
    await user.click(screen.getByText("open-i"));

    await user.click(screen.getByLabelText("关闭 物料库存查询"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/production");
  });
});
