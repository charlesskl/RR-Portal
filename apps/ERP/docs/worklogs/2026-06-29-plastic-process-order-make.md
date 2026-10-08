# 塑胶加工订单制作(⑩发外加工占位落地)· 2026-06-29

## 做了什么
⑩ 发外加工「塑胶加工订单制作」落地——只读单表平铺查询(只显示已审核 BOM·调整审核='1'),把已审核塑胶 BOM 按生产单展开。**塑胶订单制作(⑦)的克隆**,加 **色粉号 / 加工内容** 列(发外加工口径)。
- **后端**(扩 `PlasticMaterialDocService`):`ProcessOrderMakeListAsync(起,止,keyword?)` —— 与 `OrderMakeListAsync` **字节级一致·仅 SELECT 加 `p.[色粉号], p.[加工内容]`**(同 JOIN 链 生产制单货号 JOIN 共用物料表 JOIN 生产制单 LEFT JOIN 物料资料·调整审核='1'·订购数量=用量×计划数量·金额=订购×加工单价)。新 `PlasticProcessOrderMakeController`(`api/plastic-process-order-make`·菜单 塑胶加工订单制作[组 发外加工]·加工单价/金额脱敏)。**OrderMakeListAsync 不动(并行新方法)。**
- **前端**:`PlasticProcessOrderMakePage`(克隆 `PlasticOrderMakePage`·颜色后加 色粉号/加工内容 列)+ `api/plasticProcessOrderMake.ts`。路由 `/plastic-process-order-make`·menuTree ⑩ 占位落地。

## 决策
= 塑胶订单制作 发外加工版(同 BOM 源·调整审核='1'·订购数量=用量×计划数量)+ 色粉号/加工内容;订单单号列省略(无源·同塑胶订单制作)。

## 执行(subagent-driven)
spec(克隆+2列)→ plan(全 SQL/DTO)→ 子代理 Task1 后端(386·克隆 OrderMakeListAsync 仅加 2 列·杀锁 PID 重建)/Task2 前端(54·克隆 PlasticOrderMakePage 加 2 列)/Task3 冒烟+终审+合并。**opus 终审 READY**(8项·字节级 SQL parity 仅差 2 列·调整审核过滤·订购=用量×计划·脱敏无泄露·塑胶订单制作⑦ 模板未动[空 diff])。

## 测试 / 验证
- 后端 `PlasticProcessOrderMakeServiceDbTests`(种 款号总表父→生产制单[计划100]→生产制单货号→共用物料表[调整审核1行 色粉号C1/加工内容喷油 + 0行]→物料资料 → 仅审核1行·订购200·金额600·色粉号C1·加工内容喷油·调整审核0被滤·区间/keyword)。全量 **后端 386**(385+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:订购=用量2×计划100=200·金额600·色粉号 C1/加工内容 喷油带出·调整审核'0'行不出。

## 合并
分支 `feat-plastic-process-order-make`(2 提交)→ `--no-ff` 合并 master `35ddc6e`,分支已删。10 文件 +240/−2。

## 教训/记录
- 同一报表在多模块菜单复用(塑胶订单制作⑦ / 塑胶加工订单制作⑩):并行新方法+新 Controller+新菜单·共用 BOM 源·按需加列·原方法零改。

## 下一步
⑩发外加工余下(塑胶加工采购单/加工采购查询/白件领料单/加工入仓单/采购加工进度表等);⑦塑胶物料设置/塑胶进度明细表/塑胶物料进出汇总;⑧工模表/塑胶标签单。
