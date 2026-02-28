# ============================================
# 印尼出货明细资料核对系统 - Production Dockerfile
# 纯前端静态项目，使用 Nginx 提供服务
# ============================================

# --- Stage 1: 准备静态文件 ---
FROM alpine:3.19 AS builder

WORKDIR /build

# 复制所有 HTML 文件
COPY *.html ./

# 可选：压缩静态文件（生成 gzip 预压缩版本，Nginx 可直接使用）
RUN apk add --no-cache gzip \
    && for f in *.html; do gzip -k -9 "$f"; done

# --- Stage 2: 生产运行环境 ---
FROM nginx:1.25-alpine

# 安全：创建非 root 用户运行
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 复制自定义 Nginx 配置
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# 从 builder 阶段复制静态文件（含预压缩版本）
COPY --from=builder /build/*.html /usr/share/nginx/html/
COPY --from=builder /build/*.html.gz /usr/share/nginx/html/

# 设置文件权限
RUN chown -R appuser:appgroup /usr/share/nginx/html \
    && chown -R appuser:appgroup /var/cache/nginx \
    && chown -R appuser:appgroup /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown appuser:appgroup /var/run/nginx.pid

# 暴露端口
EXPOSE 8080

# 健康检查：每 30 秒检测一次
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO /dev/null http://localhost:8080/ || exit 1

# 以非 root 用户运行
USER appuser

CMD ["nginx", "-g", "daemon off;"]
