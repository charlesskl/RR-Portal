// 物料快速建档页:场景对照老系统 web/src/pages/materials/MaterialCreateWizard.tsx
// (三类别分流建档/来料编号留空自动/必填校验/保存后清空留单位)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MaterialCreatePage from "@/pages/MaterialCreatePage";

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "物料资料", 打开: true, 保存: true }];

function installFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url, method, body });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(PERMS_FULL));
      if (p === "/api/material-master" && method === "POST") return json({ id: 1 });
      if (p === "/api/master/plastic-materials" && method === "POST") return json({ id: 2 });
      if (p === "/api/master/plastic-raw-materials" && method === "POST") return json({ id: 3 });
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = () => {
  const calls = installFetch();
  renderWithProviders(<MaterialCreatePage />, "/material-create");
  return calls;
};

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("物料快速建档", () => {
  it("来料物料:编号留空自动(提交不带 物料编号),POST /material-master", async () => {
    const calls = setup();
    await waitFor(() => expect(screen.getByLabelText("物料名称")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "新辅料" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/material-master" &&
            c.body?.物料名称 === "新辅料" &&
            c.body?.单位 === "个" &&
            !("物料编号" in (c.body ?? {})),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("来料物料已建档")).toBeInTheDocument());
  });

  it("来料物料:物料名称必填", async () => {
    const calls = setup();
    await waitFor(() => expect(screen.getByText("保存")).toBeInTheDocument());
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填物料名称")).toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("塑胶物料:编号必填,带 工模编号/款号 字段,POST /master/plastic-materials", async () => {
    const calls = setup();
    await waitFor(() => expect(screen.getByText("塑胶物料")).toBeInTheDocument());
    fireEvent.click(screen.getByText("塑胶物料"));
    // 编号必填
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "胶件X" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填物料编号")).toBeInTheDocument());
    // 填齐后保存
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "PL-9" } });
    fireEvent.change(screen.getByLabelText("工模编号"), { target: { value: "MOLD-9" } });
    fireEvent.change(screen.getByLabelText("款号"), { target: { value: "92125-MA" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/plastic-materials" &&
            c.body?.物料编号 === "PL-9" &&
            c.body?.工模编号 === "MOLD-9" &&
            c.body?.款号 === "92125-MA",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("塑胶物料已建档")).toBeInTheDocument());
  });

  it("塑胶原料:带 商品名称/产地/每包重量,POST /master/plastic-raw-materials", async () => {
    const calls = setup();
    await waitFor(() => expect(screen.getByText("塑胶原料")).toBeInTheDocument());
    fireEvent.click(screen.getByText("塑胶原料"));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "RAW-1" } });
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "PVC粉" } });
    fireEvent.change(screen.getByLabelText("产地"), { target: { value: "台湾" } });
    fireEvent.change(screen.getByLabelText("每包重量"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/plastic-raw-materials" &&
            c.body?.产地 === "台湾" &&
            c.body?.每包重量 === 25,
        ),
      ).toBe(true),
    );
  });

  it("保存成功后表单清空且单位保留 个", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText("物料名称")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("物料名称"), { target: { value: "新辅料" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("来料物料已建档")).toBeInTheDocument());
    expect(screen.getByLabelText("物料名称")).toHaveValue("");
    expect(screen.getByLabelText("单位")).toHaveTextContent("个");
  });
});
