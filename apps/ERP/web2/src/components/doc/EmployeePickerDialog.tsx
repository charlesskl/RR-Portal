// 员工选择弹窗(半成品出库单 领料人/拉长/收件人/制单人、报废单 报废人 共用;
// 对照老系统 web/src/pages/materials/EmployeePicker.tsx:人事档案关键字查询,点行返回姓名)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { employeesApi } from "@/api/endpoints";
import { Input } from "@/components/ui/input";
import { PickerDialog, pickerThCls } from "./PickerDialog";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

export function EmployeePickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (姓名: string) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const query = useQuery({
    queryKey: ["employee-picker", kw],
    queryFn: () => employeesApi.list(1, 200, kw),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = query.data?.items ?? [];

  return (
    <PickerDialog open={open} onClose={onClose} title="选择人员(人事档案)" width="sm:max-w-[560px]">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setKw(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="编号/姓名"
          aria-label="人员搜索"
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
        />
        <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
          查询
        </button>
      </form>
      <table className="w-full text-[15px]">
        <thead>
          <tr>
            {["编号", "姓名", "部门", "职称"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((emp, i) => (
            <tr
              key={emp.编号 ?? i}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(emp.姓名 ?? "");
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 text-[#3d4a5c]">{emp.编号}</td>
              <td className="px-3 py-2 text-[#1a2330]">{emp.姓名}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{emp.部门编号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{emp.职称}</td>
            </tr>
          ))}
          {query.isSuccess && rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的人员
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PickerDialog>
  );
}
