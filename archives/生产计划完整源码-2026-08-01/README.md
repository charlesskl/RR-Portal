# 生产计划管理系统

端口：**8080**

A/B/华登三个车间的生产计划管理系统，支持排期 Excel 上传解析、自动排拉、实时编辑（Luckysheet 工具栏）、导出 Excel。

## 启动

```bash
cd server
npm install
node app.js
```

前端：

```bash
cd client
npm install
npm run build
```

打开 http://localhost:8080

## 核心功能

- **上传排期** — 拖拽或点击上传，XML 解析颜色检测新单（黄色）
- **自动排拉** — 同货号分同一拉，按走货期排序，各拉数量均衡
- **Luckysheet 编辑** — 完整 Excel 工具栏（字体、颜色、对齐、合并、边框、筛选）
- **合计/汇总** — 同货号合计列 + 底部汇总行
- **拉 tab 切换** — 按 A1~A4/B1~B3/C1~C5 筛选
- **导出 Excel** — 按车间导出，格式对齐金山文档

## 车间配置

| 车间 | 厂区 | 主管 | 拉 |
|------|------|------|---|
| A | 兴信A | 吴其雄 | A1~A4 |
| B | 兴信B | 吴敏敏 | B1~B3 |
| 华登 | 华登 | 刘荣华 | C1~C5 |

## 数据去重

导入时按 **合同 + 货号 + 车间** 去重，重复订单自动跳过。

## 技术栈

- 前端：React + Vite + Ant Design + Luckysheet
- 后端：Express + better-sqlite3 + JSZip + ExcelJS
- 颜色检测：直接解析 xlsx 的 XML（ExcelJS 读不到间接样式）
