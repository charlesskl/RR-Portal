# HTTP 接入（显式启用）

按用户要求允许云端 http://8.148.146.194:3100。HTTP 不加密登录密码、站点令牌或业务资料；HTTPS 默认行为保留。

## 服务器管理员

如果使用本应用独立 compose.yaml，在现有 .env 中保留 ADMIN_PASSWORD 并加入：

```env
COOKIE_SECURE=false
PLATFORM_BIND_IP=0.0.0.0
```

在应用目录、沿用当前部署的 Compose 项目名和持久卷，执行单服务重新创建：`docker compose -p printlink up -d --build --no-deps platform`。如果原部署项目名不是 printlink，必须替换为原名，避免误建空数据卷。不要删除数据卷。

如使用门户主 Compose 或其他启动方式，在实际 platform 服务中设置 COOKIE_SECURE=false，并检查 3100 的监听与安全组规则；本目录设置不会自动修改其他 Compose。重启后从 HTTP 登录验证会话有效。保留 HttpOnly、SameSite 与 CSRF 验证。

## Windows

使用新版桥接文件，将 collector/bridge.http.example.json 复制为 collector/bridge.local.json；已有配置则只改 cloudUrl 并加入 `"allowInsecureHttp": true`，保留原令牌、账号、机台映射和绑定路径。

原系统地址仍为 http://127.0.0.1:3000。补齐站点 token 和原系统登录信息后运行 collector/启动Windows桥接.cmd。预检查与实际运行均允许显式开启的 HTTP。不要同时启动两份采集站。更新程序保留 runtime 队列和 bindings 文件。

恢复 HTTPS 时，将 cloudUrl 改为 HTTPS，删除 allowInsecureHttp 或设为 false，服务器 COOKIE_SECURE 改回 true；有同机反向代理时可将 PLATFORM_BIND_IP 改回 127.0.0.1。

本改动提供代码和部署配置，不代表云服务器已自动更新。
