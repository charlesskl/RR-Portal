# 华登包材管理系统 (huadeng)

3 个板块 (华登/邵阳华登、华登/兴信、邵阳华登/兴信) 的包材出入库管理,
双向 6 channel,13 种包材分类统计,含报表导出与三角债查询。

## 技术栈

- Flask + SQLite + Jinja2 + xlsxwriter
- 单文件 Flask 应用 (`app.py`)

## 独立版本

本插件初始版本为独立 Flask 项目: https://github.com/fxxaxxx/baocaiguanli

## 本地运行

```bash
pip install -r requirements.txt
python app.py
# http://127.0.0.1:7000
```

## 容器部署

通过根目录 `docker-compose.yml` 中的 `huadeng` service 启动,
数据持久化目录挂载为 `./apps/huadeng/data`。
