// SearchSelect 可搜索下拉:打开/过滤/选择/清空/键盘导航/禁用/少选项无搜索框/宽度透传
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SearchSelect, SEARCHABLE_MIN, type SearchSelectOption } from "@/components/doc/SearchSelect";

const FEW: SearchSelectOption[] = [
  { value: "C-1", label: "ZURU" },
  { value: "C-2", label: "凯福适" },
  { value: "C-3", label: "龙昌" },
];
const MANY: SearchSelectOption[] = Array.from({ length: SEARCHABLE_MIN + 2 }, (_, i) => ({
  value: `C-${i + 1}`,
  label: `客户${String(i + 1).padStart(2, "0")}`,
}));
MANY[1] = { value: "C-2", label: "龙昌加工" };

function Host({
  options = FEW,
  disabled = false,
  className,
  style,
}: {
  options?: SearchSelectOption[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [v, setV] = useState("");
  return (
    <SearchSelect
      ariaLabel="客户"
      value={v}
      options={options}
      placeholder="选择客户(可选)"
      clearLabel="选择客户(可选)"
      disabled={disabled}
      className={className}
      style={style}
      onChange={setV}
    />
  );
}

afterEach(cleanup);

describe("SearchSelect", () => {
  it("打开后显示全部选项+清空行,选择后按钮显示所选", () => {
    render(<Host />);
    const btn = screen.getByRole("button", { name: "客户" });
    expect(btn).toHaveTextContent("选择客户(可选)");
    fireEvent.click(btn);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4); // 清空行 + 3 项
    fireEvent.click(screen.getByRole("option", { name: "凯福适" }));
    expect(btn).toHaveTextContent("凯福适");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("选项 ≤8:不显示搜索框,键盘 ↓/Enter 直接选择", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "客户" }));
    expect(screen.queryByLabelText("客户搜索")).not.toBeInTheDocument();
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" }); // 清空行 → ZURU
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(screen.getByRole("button", { name: "客户" })).toHaveTextContent("ZURU");
  });

  it("选项 >8:显示搜索框,输入关键字过滤(名称/值),Enter 选高亮项", () => {
    render(<Host options={MANY} />);
    fireEvent.click(screen.getByRole("button", { name: "客户" }));
    fireEvent.change(screen.getByLabelText("客户搜索"), { target: { value: "龙" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["龙昌加工"]);
    fireEvent.keyDown(screen.getByLabelText("客户搜索"), { key: "Enter" });
    expect(screen.getByRole("button", { name: "客户" })).toHaveTextContent("龙昌加工");
  });

  it("清空行可清除已选;无匹配显示提示;禁用不可打开", () => {
    render(<Host options={MANY} />);
    const btn = screen.getByRole("button", { name: "客户" });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("option", { name: "客户01" }));
    expect(btn).toHaveTextContent("客户01");
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("option", { name: "选择客户(可选)" }));
    expect(btn).toHaveTextContent("选择客户(可选)");
    fireEvent.click(btn);
    fireEvent.change(screen.getByLabelText("客户搜索"), { target: { value: "不存在" } });
    expect(screen.getByText("无匹配项")).toBeInTheDocument();
    cleanup();
    render(<Host disabled />);
    fireEvent.click(screen.getByRole("button", { name: "客户" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("列表内部滚动不关闭;外部滚动若锚点未动也不关,锚点真移动才关", () => {
    render(<Host />);
    const btn = screen.getByRole("button", { name: "客户" });
    let top = 100;
    const rect = () =>
      ({ top, left: 10, width: 120, height: 30, bottom: top + 30, right: 130, x: 10, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(btn, "getBoundingClientRect").mockImplementation(rect);
    fireEvent.click(btn);
    const listbox = screen.getByRole("listbox");
    const scroller = listbox.querySelector(".overflow-auto");
    expect(scroller).not.toBeNull();
    fireEvent.scroll(scroller as Element); // 内部滚动(滚轮)
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.scroll(document); // 外部滚动但锚点未动(伪滚动)
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    top = 300; // 页面真滚动,触发钮位置变了
    fireEvent.scroll(document);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Esc 只关下拉:document bubble 监听(如 radix 弹窗)收不到该事件", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "客户" }));
    const radixLike = vi.fn();
    document.addEventListener("keydown", radixLike); // 模拟 radix DismissableLayer 的 bubble 监听
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", radixLike);
    expect(radixLike).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("className/style 透传到触发钮", () => {
    render(<Host className="extra-cls" style={{ width: "14ch" }} />);
    const btn = screen.getByRole("button", { name: "客户" });
    expect(btn.style.width).toBe("14ch");
    expect(btn.className).toContain("extra-cls");
  });
});
