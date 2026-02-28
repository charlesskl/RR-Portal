# ZURU 9565 包材 MA 差价计算系统

计算 ZURU Pets Alive Squirrel (#9565) 包装物料 MA 大货订单与实际 PO 之间的阶梯价差异，并生成 Royal Regent Commercial Invoice。

## 启动项目

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 使用方法

### 1. 导入排期表

- 上传 **9565 松鼠生产排期表** (.xlsx)，系统会自动读取：
  - PO 数据（PO 号、Item、数量、包装物料用量）
  - 包材 MA 记录（从「包材MA」分页读取）
- 上传 **9565 松鼠报价表 Quotation** (.xls/.xlsx)，系统会读取每个 Item 的阶梯价

### 2. PO 差价计算

- 从左侧列表选择一个 PO 号码
- 系统自动匹配：
  - 该 PO 对应的报价表 Item
  - 每种包装物料的 MA 记录（默认使用最新 MA）
- 根据 MA 数量和 PO 数量分别查找阶梯价，计算差价
- 可手动切换使用哪个 MA 记录
- 点击「生成 Invoice」保存并预览

### 3. 阶梯价格表

- 查看所有已导入 Item 的包装物料阶梯价明细

### 4. Invoice 记录

- 查看和打印已保存的 Commercial Invoice（Royal Regent 格式）
- 支持导出 CSV

## 计算逻辑

- **MA 阶梯价**：根据 MA 订单数量查找报价表对应区间的单价
- **PO 阶梯价**：根据 PO 数量查找报价表对应区间的单价
- **差价** = MA 单价 - PO 单价（负数 = MA 批量折扣）
- **应收差额** = 差价 x 包材数量

## 技术栈

- Next.js + TypeScript + Tailwind CSS
- SheetJS (xlsx) 浏览器端 Excel 解析
- localStorage 本地数据持久化
