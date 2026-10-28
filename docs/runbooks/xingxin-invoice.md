# 兴信大陆发票系统接入说明

- 应用：`apps/业务部/兴信大陆发票系统`
- Compose 服务：`xingxin-invoice`，容器内 Nginx 监听 `80`
- 门户入口：业务部 → 兴信大陆发票系统，URL `/xingxin-invoice/`
- 健康检查：容器 `/health`；门户 `/xingxin-invoice/health`

## 运行方式与数据边界

应用为 React/Vite 静态站点。导入的表格、生成的发票在用户浏览器内处理，不上传到 Nginx 容器；浏览器历史记录与下载文件由用户自行保管。容器没有数据库和业务数据目录，无需 bind mount，也不依赖原始多厂区系统启动。

云端网关剥离 `/xingxin-invoice/` 前缀后转发到 `xingxin-invoice:80`。业务页面、JavaScript 和模板继承门户 Basic Auth；仅健康检查免认证。运行时资源使用相对路径，独立端口及门户子路径共用同一构建产物。

本地 `docker-compose.yml` 绑定 `127.0.0.1:3480:80`，可通过 `XINGXIN_INVOICE_PORT` 调整；云端 compose 不暴露宿主机端口。仓库目前没有本地网关 nginx 配置或本地网关服务，本地独立访问入口为 `http://127.0.0.1:3480/`。要在不配置其他业务服务环境变量的情况下单独验证，可执行：

```bash
docker build -t rr-xingxin-invoice ./apps/业务部/兴信大陆发票系统
docker run --rm --name rr-xingxin-invoice-local -p 127.0.0.1:3480:80 rr-xingxin-invoice
```

## 门户、健康检查与增量更新

`frontend/index.cloud.html` 与 `frontend/index.html` 均登记业务部卡片和健康状态。云端维护模式只阻断 `/xingxin-invoice` 所属 URL，门户首页和其他系统保持可用。

`deploy/update-server.sh` 将应用目录映射到 `xingxin-invoice`。后续只修改该目录时，仅构建并重建该服务；初次增加 compose 服务会沿用仓库现有 compose 变动的部署流程。服务健康失败时保留该系统的维护标志。

`devops/scripts/safe-redeploy.sh` 已登记 `/xingxin-invoice/health`。`devops/config/apps.json` 的状态为 `container-monitored`：使用 Docker HEALTHCHECK、门户探测和安全部署脚本检查。旧版 `health-check.sh` 仅支持直接端口的 `/health`，且仅枚举 `active`，因此不会把门户的 `/health` 错当作本系统健康状态。注册表的 `port: 80` 是容器端口；`ports.json` 的 `port: 3480` 是本地宿主机端口。

## 验证

```bash
# 构建容器后，在另一终端验证静态页与 JSON 健康检查
curl --fail http://127.0.0.1:3480/health
curl --fail http://127.0.0.1:3480/

# 本地回归：有 Bash 4+ 和 nginx 时执行全部行为用例
python3 -m unittest discover -s deploy/tests -p test_service_maintenance.py -v
```

新增回归覆盖：仅应用目录变动时只部署兴信、健康端点免认证、页面与模板需要门户认证、子路径转发、裸路径跳转、维护模式隔离。测试使用临时目录、模拟 Docker 和本地 HTTP 服务，不连接生产服务器。没有 nginx 或 Bash 4+ 的环境会明确跳过相应用例。
