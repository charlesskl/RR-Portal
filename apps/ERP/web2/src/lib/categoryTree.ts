// 物料类别树纯函数(物料资料/塑胶物料资料共用;树组装逻辑照抄老系统
// web/src/pages/materials/MaterialMasterPage.tsx:扁平节点按 父级 组两层树,
// key=主数据编号,物料行自带类别用 ~名称)。

export interface CategoryNodeLike {
  编号?: string;
  类别?: string;
  数量: number;
  父级?: string | null;
}

export interface CatInfo {
  key: string;
  name: string; // = 物料资料.物料类别 过滤值
  code?: string; // 主数据编号(物料行自带类别无)
  parent: string | null; // 父节点 key
  count: number;
  hasChildren: boolean;
}

export const ALL_CAT_KEY = "__ALL__";

// 扁平节点 → key/父子 映射(key:主数据编号,物料自带类别用 ~名称)
export function buildCategoryTree(cats: CategoryNodeLike[]) {
  const infos = new Map<string, CatInfo>();
  for (const c of cats) {
    const name = c.类别 ?? "";
    const key = c.编号 ?? `~${name}`;
    if (!name || infos.has(key)) continue;
    infos.set(key, {
      key,
      name,
      code: c.编号 ?? undefined,
      parent: null,
      count: c.数量,
      hasChildren: false,
    });
  }
  const childrenOf = new Map<string, CatInfo[]>();
  const roots: CatInfo[] = [];
  for (const c of cats) {
    const key = c.编号 ?? `~${c.类别 ?? ""}`;
    const info = infos.get(key);
    if (!info) continue;
    const parentKey = c.父级 && infos.has(c.父级) ? c.父级 : null;
    info.parent = parentKey;
    if (parentKey) {
      const arr = childrenOf.get(parentKey) ?? [];
      arr.push(info);
      childrenOf.set(parentKey, arr);
      infos.get(parentKey)!.hasChildren = true;
    } else {
      roots.push(info);
    }
  }
  return { roots, childrenOf, infoByKey: infos };
}
