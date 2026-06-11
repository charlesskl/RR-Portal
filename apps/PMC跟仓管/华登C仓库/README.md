# C仓库（独立版）

SR3703 贴纸卷配比工具。从公司框架剥离的独立单机版，**无需登录**，本地直接打开。

## 运行

```bash
pip install -r requirements.txt
python run.py
```

然后浏览器打开 http://127.0.0.1:5005/

## 用法

- 选货号 → 输入总套数 → 即时算出各 SR 货号需要量
- 「📥 导入新货号」上传 .xlsx/.xls（货号自动从表格首格 / 文件名识别）
- 「删除当前」删除当前货号的生产资料

## 数据

所有货号 Excel 存在 `data/` 目录下，一个货号一个 `<货号>.xlsx` 文件。
直接往 `data/` 放 xlsx 也可以，刷新页面即可见。

## 文件说明

- `run.py` — 启动入口
- `app.py` — Flask 应用（路由）
- `parser.py` — 贴卷纸解析/配比算法
- `templates/index.html` — 页面
- `data/` — 货号 Excel 数据
