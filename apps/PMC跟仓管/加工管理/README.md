# 77794 PCBA 主板物料流转与汇总系统

局域网网页系统，录入来料入仓/领料/成品入仓流水，自动汇总各加工点应存与来料仓余额，支持导出 Excel。

## 安装

```
python -m pip install -r requirements.txt
```

## 启动

双击 `启动.bat`，或运行：

```
python -m uvicorn pcba.main:app --host 0.0.0.0 --port 8000
```

- 本机访问：http://localhost:8000
- 局域网同事访问：http://本机IP:8000（在本机 `ipconfig` 查 IPv4 地址）

## 默认账号

- 管理员：`admin` / `admin123`（首次登录后请在用户管理里改密或新增账号）

## 角色权限

- 管理员：录入、改/删任意记录、用户管理、导出
- 录入员：录入、改/删自己录入的记录、看汇总、导出

## 备份

数据全部在 `data/pcba.db`，定期复制此文件即可备份。

## 测试

```
python -m pytest -v
```
