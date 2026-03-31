# Pitfalls Research

**Research Date:** 2026-03-17
**Domain:** Common mistakes when adding inline editing, formula engine, and validation to existing Vue apps

---

## Critical Pitfalls (Data Loss or Rewrite Risk)

### 1. saveCell 并发竞态 — Tab 键跳转
- **Problem:** Tab 触发 blur → saveCell → PUT + loadData()。快速 Tab 连跳多格时，两个并发 PUT + 两个并发 loadData() 会互相覆盖，用户填写的值被刷掉
- **Warning signs:** 用户反馈"填了数据但保存后消失了"
- **Prevention:** 重构为乐观更新（直接改 tableData，不全量 loadData），仅在出错时回滚
- **Phase:** 第二阶段（录入体验升级）开始前必须解决

### 2. 公式引擎 eval 注入
- **Problem:** 开发者最容易"省事走捷径"直接用 eval() 执行用户输入的公式
- **Warning signs:** 代码中出现 eval()、new Function()、setTimeout(string)
- **Prevention:** 白名单 AST 解析器（expr-eval CDN）+ 后端计算；PROJECT.md 已明确禁止 eval
- **Phase:** 第五阶段（公式设置窗口）

### 3. loadData 全量刷新竞态
- **Problem:** 保存后立刻重载整个表格，快速连续编辑时正在输入的格被服务器旧值覆盖
- **Warning signs:** 编辑第二个格时第一个格的值"闪回"旧值
- **Prevention:** 乐观更新模式 — 直接修改本地 tableData，出错再回滚
- **Phase:** 第二阶段

### 4. app.js 全局常量修改破坏所有部门
- **Problem:** DEPT_CONFIG 被三个部门组件隐式共享，结构变化不报错只有行为异常
- **Warning signs:** 改了一个部门的字段，另外两个部门显示异常
- **Prevention:** 修改前 Grep 搜所有引用点，新增属性只追加不重构现有结构
- **Phase:** 贯穿所有阶段

### 5. 数据校验过严拦截合法数据
- **Problem:** "费用不能超产值"在启动期是合法的（结余为负）；"产值不为0"会拦截停产日记录
- **Warning signs:** 录入员反馈"系统不让我录数据"
- **Prevention:** 区分"拦截型"（阻止提交）和"警告型"（标黄但允许提交）；规则逐一与统计组确认
- **Phase:** 第三阶段

## Moderate Pitfalls

### 6. Tab 跳转跳进计算字段
- **Problem:** Tab 应只在 editable 字段间跳转，跳过 calculated 列
- **Prevention:** 从 DEPT_CONFIG 的 editableColumns 列表驱动跳转顺序
- **Phase:** 第二阶段

### 7. 前端 SheetJS 解析大文件阻塞 UI
- **Problem:** 前端同步解析 Excel 会冻结浏览器
- **Prevention:** 解析工作放后端（当前已是后端解析），预览数据通过 API 返回
- **Phase:** 第四阶段

### 8. Excel 中文列名含全角空格/零宽字符
- **Problem:** 导入时列名匹配失败，数据静默丢失
- **Prevention:** cleanColumnName() 需覆盖全角空格、零宽字符、BOM 等
- **Phase:** 第四阶段

### 9. 复制上一行携带 id 和计算字段
- **Problem:** 复制行时如果包含了 id，保存时会覆盖原行而非创建新行
- **Prevention:** 用白名单只复制 editable 输入字段，排除 id、计算字段、日期
- **Phase:** 第二阶段

### 10. 异常高亮的历史均值查询拖慢页面
- **Problem:** 每次加载表格都查询历史均值，数据量大时显著变慢
- **Prevention:** 异步加载均值数据，不阻塞主表格渲染；可缓存月均值
- **Phase:** 第三阶段

## Minor Pitfalls

### 11. 批量填充绕过数据锁定
- **Problem:** 批量操作可能绕过 checkDataLock 中间件
- **Prevention:** 确保批量操作走相同的锁定检查路径
- **Phase:** 第二阶段

### 12. 数据对比上月计算在 1 月出错
- **Problem:** month - 1 在 1 月份得到 month=0，触发 SQL 错误
- **Prevention:** 1 月对比去年 12 月，需同时调整年份
- **Phase:** 第三阶段

### 13. 拖拽排序只更新一行
- **Problem:** 拖拽后只更新被拖动的行的 sort_order，其他行顺序不一致
- **Prevention:** 批量更新所有受影响行的 sort_order
- **Phase:** 第五阶段

---

*Pitfalls research: 2026-03-17*
