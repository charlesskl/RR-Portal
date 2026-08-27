# 自动化设备统计

生产自动化设备投资、生产量、节省成本和结余统计系统。

## 架构

- `src/`：Vite + React 前端（构建产物 `dist/`），通过 `api/` 相对路径调用后端。
- `server.js`：Express 后端，JSON 文件存储（`data/data.json`，首次启动用 2026-08-15 快照种子初始化，原子写入）。
- `Dockerfile`：两阶段构建（vite build → 生产运行时），容器端口 3008。

## API

- `GET /health`：健康检查。
- `GET /api/state`：全量数据（设备 / 产量记录 / 用户）。
- `POST /api/equipment`、`PUT /api/equipment/:id`：设备台账新增 / 编辑（服务端重算投资、节省、结余）。
- `POST /api/records`：录入产量，自动累加设备实际生产数与节省成本。
- `POST /api/users`、`PATCH /api/users/:id`：用户新增与启停。

## 开发

```bash
npm install
npm run build
npm start        # http://localhost:3008
```

线上经 RR Portal nginx 部署在 `/automation-equipment/` 子路径下。
