// 特殊资料按货物行判断，厂区和相同货号不作为判定依据。
const specialFields=["customer_item_number","order_total_quantity","net_net_weight","net_net_weight_per_box","measurement_per_box","production_line"] as const;
export function hasSpecialCargoDetails(item:Record<string,unknown>,specialTemplate=false):boolean{
  return specialTemplate||specialFields.some(key=>item[key]!=null&&String(item[key]).trim()!=="");
}
