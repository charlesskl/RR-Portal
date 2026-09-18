# QC 验货管理系统部署与对接

## 部署给公司服务器管理员

运行环境：Docker Compose；公司反向代理负责 HTTPS、域名和访问控制。仓库中不包含生产数据库或密钥。

1. 在 `deploy/` 下将 `.env.example` 复制为 `.env`，分别设置不少于 32 字符的随机 `QC_JWT_KEY` 和 `QC_SHIPPING_API_KEY`。上线后保持 JWT 密钥稳定，否则现有登录会失效。不要提交 `.env`。
2. 在 `deploy/data/` 放置需要迁移的 `qc-inspection.db`，先从原运行环境备份数据库；若是全新系统，可让服务自动创建空库，并在 `.env` 设置 `QC_ADMIN_PASSWORD` 创建首个管理员账号。数据库目录必须可供容器写入。迁移前先停止原系统，连同 WAL 文件完成一致性备份，避免遗漏未合并的数据。
3. 在 `deploy/` 运行 `docker compose up -d --build`。网关仅监听服务器本机 `127.0.0.1:8080`，由公司反向代理将正式域名的 HTTPS 请求转发至该端口。`/api/` 和页面必须经过同一域名，以便浏览器调用接口。
4. 验证 `https://<公司域名>/api/health` 返回 `status: ok`，匿名打开 `https://<公司域名>/` 可查看验货计划；使用现有 QC 账号登录，检查首页、验货结果和车间主管映射。
5. 持续备份 `deploy/data/qc-inspection.db`。升级前备份数据库并在测试环境先验证；SQLite 适合当前单实例部署，不要同时运行多个 API 实例写同一数据库。

`NEXT_PUBLIC_QC_API_URL` 在云端不需要设置，前端默认通过同域 `/api/` 访问后端。本地开发仍默认使用 `http://127.0.0.1:5188`。如果前后端必须使用不同域名，构建前设置 `NEXT_PUBLIC_QC_API_URL`，同时在 API 配置 `QC_WEB_ORIGINS`（逗号分隔的精确网页来源），并重新构建前端。

## 船务系统查询验货结果

由公司服务器向 QC 服务端发出 GET 请求，不在浏览器中保存接口密钥：

```http
GET /api/integrations/shipping/results?contractNumber=HT123&itemNumber=SKU1&page=1
Authorization: Bearer <与 QC_SHIPPING_API_KEY 相同的密钥>
```

RR 仓库现有船务查询代理使用 `QC_SYSTEM_API_URL` 和 `QC_SYSTEM_API_TOKEN`：前者设为本接口完整地址，后者设为与 `QC_SHIPPING_API_KEY` 相同的密钥。接口也兼容 `X-QC-API-Key` 请求头。可按 `contractNumber`（合同号）、`customerPo`（客户 PO）、`itemNumber`（货号）任一字段精确查询，也可组合；可选 `site`（兴信、湖南、华登、待分配）及 `page`。至少提供一个单号字段。只返回已登记结果的记录，每页最多 100 条，按验货日期倒序。响应包含 `total`、`page`、`pageSize`、`totalPages`、`items`；每项包含 `planId`、厂区、验货日期、客户、各单号、产品、内部结果、第三方结果、HOLD/REJ 原因及流程状态。无匹配结果返回 `items: []`；密钥不正确返回 401；未配置密钥返回 503。接口密钥应只在两系统服务端配置，走 HTTPS 或公司受控内网。

多条货物明细使用 `POST /api/integrations/shipping/results/batch`，请求体为 `{"items":[{"contractNumber":"HT123","customerPo":"","itemNumber":"SKU1"}]}`，最多 500 条。认证方式与单条接口相同；非空查询字段均需精确一致，空字段不参与匹配。响应的 `results` 与请求顺序一致，每项包含 `itemIndex`、匹配总数 `total` 和按验货日期排序的最近一条 `latest`；无匹配时 `latest` 为 `null`。原 GET 接口保留。更新云端时先部署 QC，再部署船务；QC 启动时会自动建立查询索引，不修改已有验货数据。

使用 RR 根目录的 `docker-compose.cloud.yml` 部署时，在服务器的根级环境文件中设置 `QC_PLAN_SHIPPING_API_KEY`（至少 32 字符），Compose 会将同一密钥提供给 QC 的 `QC_SHIPPING_API_KEY` 和船务的 `QC_SYSTEM_API_TOKEN`。保持已有 `QC_PLAN_JWT_KEY` 不变；这两个密钥都不要提交到仓库。船务的 `QC_SYSTEM_API_URL` 默认指向同一 Compose 网络内的 `qc-plan-api:5188`。

正式字段映射与船务系统管理员联调时确认；当前接口已经覆盖合同号、客户 PO、货号三种常用匹配方式。

## 总 QC 系统入口（待对接协议）

普通链接 `https://<公司域名>/?view=plans` 只能进入本系统现有的公开只读页；它**不能**代表总 QC 系统用户登录，也不能赋予编辑权限。总 QC 系统统一管理账号和模块、查看、编辑权限的要求，需要与其现有身份接口对接后才能交付。

联调前请总 QC 系统管理员提供：现有其他子系统的登录跳转协议或示例；身份令牌/授权码的签发与验证方式；用户唯一标识；模块与操作权限字段及更新方式；退出、禁用和权限变更的生效规则；正式域名和回调地址。优先采用已有的标准身份协议。不能仅靠 URL 中的用户名、角色或一个共享账号自动登录。
