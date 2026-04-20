# 配色库存管理系统

单人本地使用的颜料/油漆库存管理 Web 应用。

## 启动

    pip install -r requirements.txt
    python run.py

浏览器访问 http://127.0.0.1:5000

## 功能

- 颜料档案（品牌/色号/色样/规格/低库存阈值）
- 当前库存与低库存预警
- 出入库流水（入库 / 出库 / 盘点）
- 调色配方（可行性检查、按配方一键出库）
- Excel 导入 / 导出 / 模板下载

## 测试

    python -m pytest -v

## 数据存储

SQLite 文件位于 `instance/peise.db`。定期备份该文件即可。

## 技术栈

Flask · SQLAlchemy · Pandas · openpyxl · Bootstrap 5 · DataTables · Chart.js
