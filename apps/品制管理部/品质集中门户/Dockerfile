# ─── 构建阶段：Vite 静态构建 ───
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# SSO 密钥在构建时注入前端包（门户在浏览器端签发 JWT，需与各系统后端 SSO_SECRET 一致）
ARG VITE_SSO_SECRET
ENV VITE_SSO_SECRET=$VITE_SSO_SECRET
RUN npm run build

# ─── 运行阶段：nginx 托管静态文件 ───
FROM nginx:1.25-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
