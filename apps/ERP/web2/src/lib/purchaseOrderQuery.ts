// 订购单查询·参数归一化(照抄老系统 web/src/utils/purchaseOrderQuery.ts):
// 空串/ALL 类别 -> undefined(不下发该条件);日期类型透传。
import type { OrderQueryParams } from "@/api/types";
import { ALL_CAT } from "./purchaseReceipt";

const trim = (v?: string) => {
  const t = v?.trim();
  return t ? t : undefined;
};

export function buildOrderQuery(args: {
  供应商?: string;
  keyword?: string;
  类别?: string;
  起?: string;
  止?: string;
  日期类型?: string;
}): OrderQueryParams {
  return {
    供应商: trim(args.供应商),
    keyword: trim(args.keyword),
    物料类别: args.类别 && args.类别 !== ALL_CAT ? args.类别 : undefined,
    起: trim(args.起),
    止: trim(args.止),
    日期类型: trim(args.日期类型),
  };
}
