# RR Portal 插件开发接入指南

## 概述

RR Portal 是企业级微服务平台，每个插件是一个独立的 Docker 容器，通过 Nginx 反向代理接入平台。

## 插件类型

### Standalone Service（推荐）

用你熟悉的技术栈（Node.js、Python、Go 等）开发完整应用，直接容器化接入。

**适用场景**：大多数业务应用。

### Plugin SDK 插件

使用 Python/FastAPI + plugin_sdk 统一架构。

**适用场景**：需要核心权限系统或共享 PostgreSQL 数据库。

---

## Standalone 插件接入步骤

### 1. 准备代码

确保你的应用：
- 监听一个固定端口（如 3000、8080）
- 端口可通过环境变量配置：`process.env.PORT` / `os.environ["PORT"]`

### 2. 创建 Dockerfile

```dockerfile
# Node.js 示例
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```dockerfile
# Python 示例
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
```

### 3. 数据持久化

**必须使用 bind mount**（不要用 named volume）：

```yaml
volumes:
  - ./plugins/你的插件/data:/app/data
```

代码中使用环境变量指定路径：
```javascript
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
```

### 4. 添加 Health Check 端点

```javascript
// Node.js/Express
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```

```python
# Python/Flask
@app.route('/health')
def health():
    return {'status': 'ok'}
```

### 5. 添加到 docker-compose.cloud.yml

```yaml
  你的服务名:
    build:
      context: ./plugins/你的插件
      dockerfile: Dockerfile
    environment:
      - PORT=3000
    volumes:
      - ./plugins/你的插件/data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - platform-net
```

### 6. 配置 Nginx 代理

在 `nginx/nginx.cloud.conf` 中添加：

```nginx
upstream 你的服务名 {
    server 你的服务名:3000;
}

# 在 server 块内添加
location /你的路径/ {
    proxy_pass http://你的服务名/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### 7. 部署验证

```bash
# 构建并启动
docker compose -f docker-compose.cloud.yml up -d --build 你的服务名

# 检查日志
docker compose -f docker-compose.cloud.yml logs 你的服务名

# 刷新 Nginx（让它发现新服务的 DNS）
docker compose -f docker-compose.cloud.yml restart nginx

# 访问测试
curl http://localhost/你的路径/
```

---

## 环境变量规范

| 类型 | 环境变量 | 示例 |
|------|----------|------|
| 端口 | `PORT` | `3000` |
| 数据路径 | `DATA_PATH` | `/app/data` |
| 子路径 | `BASE_PATH` | `/rr` |
| API 密钥 | `XXX_KEY` | — |
| 数据库 | `DATABASE_URL` | — |

创建 `.env` 文件存放实际值，`.env.example` 存放模板。`.env` 已被 `.gitignore` 排除。

---

## 注意事项

1. **不要硬编码 IP 地址**，全部用环境变量
2. **数据文件必须在 `/app/data` 下**，通过 bind mount 持久化
3. **Alpine 镜像用 `wget` 做 health check**（没有 `curl`）
4. **推送到 main 分支会自动触发云端部署**（GitHub Actions）
5. **局域网硬件访问**需要特殊网络配置，联系管理员
