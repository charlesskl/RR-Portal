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

## 板块登录权限

3 个板块各有独立账号密码,互不相通。登录 section 1 不会自动解锁 section 2/3。
session 有效期 8 小时(同一浏览器内有效,关闭后或 8 小时后需重登)。

**默认账号密码(仅测试用,生产务必改):**

| 板块 | 账号 | 密码 |
|---|---|---|
| 华登和邵阳华登包材往来 | `hd` | `hd123456` |
| 兴信和华登包材往来 | `xx` | `xx123456` |
| 邵阳华登和兴信包材往来 | `sy` | `sy123456` |

**环境变量(部署时可覆盖默认):**

| 变量 | 说明 |
|---|---|
| `HUADENG_SECRET_KEY` | Flask session cookie 签名密钥,长随机串 |
| `HUADENG_SEC1_USER` / `HUADENG_SEC1_PASSWORD` | 华登和邵阳华登包材往来 的账号/密码 |
| `HUADENG_SEC2_USER` / `HUADENG_SEC2_PASSWORD` | 兴信和华登包材往来 的账号/密码 |
| `HUADENG_SEC3_USER` / `HUADENG_SEC3_PASSWORD` | 邵阳华登和兴信包材往来 的账号/密码 |

详见 `.env.example`。

**公开不需登录:** 首页、汇总报表 `/reports`、三角债/汇总导出、默认单价 API。
**需要登录才能看/改:** section 详情页、channel 增删改、月统计、月更新、channel/月度 Excel 导出。
