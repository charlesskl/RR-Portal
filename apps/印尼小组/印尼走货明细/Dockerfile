FROM node:20-alpine AS frontend
WORKDIR /src/web

# China 网络：registry.npmjs.org 直连超时（部署 ECS 在阿里云内），npm ci 曾爬 35min 后崩溃、
# 导致 npm run build exit 127。构建期改用阿里云 npmmirror 镜像，降到分钟级。仅构建阶段生效。
ENV npm_config_registry=https://registry.npmmirror.com \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY web/package.json web/package-lock.json ./
COPY web/vendor ./vendor
RUN npm ci

COPY web/ ./
ARG VITE_BASE_PATH=/indo-shipping/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY src/IndoShipping.Api/IndoShipping.Api.csproj src/IndoShipping.Api/
COPY src/IndoShipping.Domain/IndoShipping.Domain.csproj src/IndoShipping.Domain/
COPY src/IndoShipping.Infrastructure/IndoShipping.Infrastructure.csproj src/IndoShipping.Infrastructure/
RUN dotnet restore src/IndoShipping.Api/IndoShipping.Api.csproj

COPY src/ ./src/
RUN dotnet publish src/IndoShipping.Api/IndoShipping.Api.csproj -c Release -o /app/publish --no-restore

FROM build AS bootstrap-build
RUN mkdir -p db \
    && touch db/rebuild_schema.sql \
    && dotnet restore src/IndoShipping.Bootstrap/IndoShipping.Bootstrap.csproj \
    && dotnet publish src/IndoShipping.Bootstrap/IndoShipping.Bootstrap.csproj -c Release -o /app/bootstrap --no-restore

FROM mcr.microsoft.com/dotnet/runtime:8.0 AS bootstrap
WORKDIR /app
COPY --from=bootstrap-build /app/bootstrap ./
ENTRYPOINT ["dotnet", "IndoShipping.Bootstrap.dll"]

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && (getent group app >/dev/null 2>&1 || addgroup --system app) \
    && (getent passwd app >/dev/null 2>&1 || adduser --system --ingroup app app)

COPY --from=build --chown=app:app /app/publish ./
COPY --from=frontend --chown=app:app /src/web/dist ./wwwroot

ENV ASPNETCORE_URLS=http://+:5180
EXPOSE 5180
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent http://localhost:5180/api/health || exit 1

ENTRYPOINT ["dotnet", "IndoShipping.Api.dll"]
