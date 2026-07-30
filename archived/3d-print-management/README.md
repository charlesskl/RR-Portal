# 3D打印管理系统

生产部使用的轻量级 3D 打印生产管理系统，基于 Node.js 原生 HTTP 服务和单页前端实现，无 npm 依赖。

## 功能

- 生产仪表盘、每日记录和设备使用率统计
- Bambu P1S MQTT over TLS 实时状态
- FlashForge HTTP API 实时状态
- 自动生成打印记录、材料库存、排期、维修和产品管理
- 月度、年度和自定义日期范围 Excel 导出
- 主从服务器数据与打印机状态同步
- 设备数量历史：2026-07-17 起 15 台，2026-07-22 起 20 台

## 本地运行

需要 Node.js 18 或更高版本。

1. 复制示例文件：

   ```bash
   cp config.example.json config.json
   cp data.example.json data.json
   ```

2. 修改 `config.json`，填写真实认证信息和打印机连接参数。
3. 启动：

   ```bash
   node server.js
   ```

4. 访问 `http://localhost:3000`。

Windows 可双击 `启动服务器.bat`；需要异常退出后自动重启时使用 `start-server.bat`。

## Docker

```bash
docker build -t 3d-print-management .
docker run --rm -p 3000:3000 \
  -e DATA_PATH=/app/data \
  -v "$PWD/data:/app/data" \
  3d-print-management
```

首次启动时，`data.json` 会从 `data.example.json` 自动生成到 `DATA_PATH`；
`config.json` 不存在时会自动生成（含随机管理员密码，打印在启动日志中）。
请在 `DATA_PATH` 下的 `config.json` 中修改密码并填写真实打印机参数。

打印机位于厂内局域网时，容器运行节点必须能访问打印机 IP 和 Bambu MQTT TLS 端口 `8883`。
未配置真实凭据（仍为 `YOUR_*` 占位符）的打印机会被自动跳过，不会触发局域网扫描。

## 数据与安全

- `config.json` 含管理员密码、设备序列号和访问码，不提交到 Git。
- `data.json` 含真实生产数据，不提交到 Git。
- 仓库仅提供 `config.example.json` 和 `data.example.json`。
- 部署前必须更换示例密码并填写本地设备参数。
