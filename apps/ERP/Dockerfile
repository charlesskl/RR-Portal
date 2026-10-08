# syntax=docker/dockerfile:1
# ERP 一体化镜像：前端 web2 构建 → 产物进 wwwroot → 后端发布 → aspnet 运行
# 云端经 nginx 部署在 /erp/ 子路径，前端 base 已在 vite.config.ts 固定为 /erp/

FROM node:22-alpine AS web
WORKDIR /src/web2
COPY web2/package.json web2/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web2/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY src/ErpApi/ErpApi.csproj src/ErpApi/
RUN dotnet restore src/ErpApi/ErpApi.csproj
COPY src/ErpApi/ src/ErpApi/
# 与 scripts/publish-windows.ps1 同顺序：先清空再填入前端产物
RUN rm -rf src/ErpApi/wwwroot
COPY --from=web /src/web2/dist/ src/ErpApi/wwwroot/
RUN dotnet publish src/ErpApi/ErpApi.csproj -c Release --no-restore -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish ./
# 图片备注上传目录，云端以 bind mount 持久化到 apps/ERP/data/uploads
RUN mkdir -p /app/wwwroot/uploads
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    TZ=Asia/Shanghai
EXPOSE 8080
ENTRYPOINT ["dotnet", "ErpApi.dll"]
